/**
 * NFR-4 and NFR-3 on one API instance: 500 attendees connected to one live
 * event over the real-time protocol, 20 chat messages a second between
 * them, and API reads alongside, against their budgets.
 *
 * Run by load/run.mjs inside the stack's network, straight to the API
 * (each virtual attendee announces its own address, as Caddy would pass
 * it on; the per-address limits are not what is measured).
 */
import http from "k6/http";
import { check } from "k6";
import execution from "k6/execution";
import { SharedArray } from "k6/data";
import { Counter, Trend } from "k6/metrics";
import { WebSocket } from "k6/websockets";

const API = __ENV.API_URL ?? "http://api:4301";
const ORIGIN = __ENV.APP_ORIGIN ?? "https://opspilot.localhost:3443";
const COOKIE = "__Host-opspilot_attendee";
const session = new SharedArray("session", () => [
  JSON.parse(open("/load/out/session.json")),
])[0];
const ATTENDEES = session.tokens.length;
/** Connections open over the first minute. */
const RAMP_S = Number(__ENV.RAMP_S ?? "60");
/** Then 3 minutes of chat at the target rate. */
const STEADY_S = Number(__ENV.STEADY_S ?? "180");
/** Each attendee writes this often: 500 every 25 s is 20 a second. */
const SEND_EVERY_MS = Number(__ENV.SEND_EVERY_MS ?? "25000");

const delivery = new Trend("chat_delivery_ms", true);
const sent = new Counter("chat_sent");
const received = new Counter("chat_received");
const gaps = new Counter("chat_sequence_gaps");
const sendFailures = new Counter("chat_send_failed");
const joinFailures = new Counter("realtime_join_failed");

export const options = {
  scenarios: {
    attendees: {
      executor: "per-vu-iterations",
      vus: ATTENDEES,
      iterations: 1,
      maxDuration: `${String(RAMP_S + STEADY_S + 90)}s`,
      exec: "attendee",
    },
    reads: {
      executor: "constant-arrival-rate",
      // Attendees read the event, their admission, the chat and the
      // questions when the page loads: each reloading once a minute (far
      // more than they do) unless READS_PER_SECOND says otherwise.
      rate: Number(__ENV.READS_PER_SECOND ?? String(Math.ceil(ATTENDEES / 60))),
      timeUnit: "1s",
      duration: `${String(STEADY_S)}s`,
      startTime: `${String(RAMP_S + 10)}s`,
      preAllocatedVUs: 50,
      exec: "reads",
    },
  },
  thresholds: {
    // NFR-4: every attendee connected and joined, every message accepted,
    // none missed, and delivered within the SLO (95% under a second).
    realtime_join_failed: ["count==0"],
    chat_send_failed: ["count==0"],
    chat_sequence_gaps: ["count==0"],
    chat_delivery_ms: ["p(95)<1000"],
    // NFR-3: API reads under 300 ms at p95, at this load.
    "http_req_duration{scenario:reads}": ["p(95)<300"],
    "checks{scenario:reads}": ["rate>0.99"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

/** An address per attendee, as the proxy would forward it. */
const addressOf = (n) =>
  `10.${String(Math.floor(n / 65536) % 256)}.${String(Math.floor(n / 256) % 256)}.${String(n % 256)}`;

/** One attendee: connect, join the chat, write now and then, read all. */
export function attendee() {
  // VU numbers are shared with the reads scenario: number the attendees by
  // this scenario's own iterations (one each).
  const n = execution.scenario.iterationInTest;
  const token = session.tokens[n];
  const delayMs = Math.floor((n / ATTENDEES) * RAMP_S * 1000);
  const endAt = Date.now() + (RAMP_S + STEADY_S) * 1000 + 15_000;
  let lastSequence = -1;
  let ackId = 0;
  let written = 0;

  setTimeout(() => {
    const socket = new WebSocket(
      `${API.replace(/^http/, "ws")}/realtime/?EIO=4&transport=websocket`,
      null,
      {
        headers: {
          Origin: ORIGIN,
          Cookie: `${COOKIE}=${token}`,
          "X-Forwarded-For": addressOf(n),
        },
      },
    );
    const emit = (event, payload) => {
      const id = ackId++;
      socket.send(`42${String(id)}${JSON.stringify([event, payload])}`);
      return id;
    };
    let joinId = -1;
    const pending = new Map();

    socket.onmessage = ({ data }) => {
      const frame = String(data);
      if (frame === "2") {
        socket.send("3"); // Engine.IO ping
        return;
      }
      if (frame.startsWith("0")) {
        socket.send("40"); // connect to the default namespace
        return;
      }
      if (frame.startsWith("40")) {
        joinId = emit("channel.join", {
          slug: session.slug,
          channel: "CHAT",
          afterSequence: 0,
        });
        return;
      }
      if (frame.startsWith("44")) {
        console.error(`attendee ${String(n)} refused: ${frame.slice(0, 200)}`);
        joinFailures.add(1);
        socket.close();
        return;
      }
      const ack = /^43(\d+)(.*)$/s.exec(frame);
      if (ack !== null) {
        const id = Number(ack[1]);
        const [body] = JSON.parse(ack[2]);
        if (id === joinId) {
          if (body.ok !== true) {
            console.error(
              `attendee ${String(n)} not joined: ${JSON.stringify(body)}`,
            );
            joinFailures.add(1);
            socket.close();
            return;
          }
          lastSequence = body.latestSequence;
          startWriting();
        } else if (pending.has(id)) {
          pending.delete(id);
          if (body.ok === true) {
            sent.add(1);
          } else {
            sendFailures.add(1);
          }
        }
        return;
      }
      if (frame.startsWith("42")) {
        const [event, payload] = JSON.parse(frame.slice(2));
        if (event !== "chat.event") {
          return;
        }
        if (lastSequence >= 0 && payload.sequence > lastSequence + 1) {
          gaps.add(payload.sequence - lastSequence - 1);
        }
        lastSequence = Math.max(lastSequence, payload.sequence);
        received.add(1);
        const match = /^t=(\d+) /.exec(payload.message.body ?? "");
        if (match !== null) {
          delivery.add(Date.now() - Number(match[1]));
        }
      }
    };
    socket.onerror = (error) => {
      console.error(
        `attendee ${String(n)} socket error: ${String(error.error ?? error)}`,
      );
      joinFailures.add(1);
    };

    function startWriting() {
      // Spread the writers evenly over the interval, from the steady phase.
      const steadyAt = (RAMP_S + 5) * 1000 - delayMs;
      const offset = Math.floor((n / ATTENDEES) * SEND_EVERY_MS);
      const write = () => {
        if (Date.now() > endAt - 20_000) {
          return;
        }
        written += 1;
        const id = emit("chat.send", {
          slug: session.slug,
          clientMessageId: uuid(),
          body: `t=${String(Date.now())} from ${String(n)} #${String(written)}`,
        });
        pending.set(id, true);
        setTimeout(write, SEND_EVERY_MS);
      };
      setTimeout(write, Math.max(0, steadyAt) + offset);
    }

    setTimeout(
      () => {
        sendFailures.add(pending.size);
        socket.close();
      },
      Math.max(0, endAt - Date.now()),
    );
  }, delayMs);
}

/** Reads attendees make while the event runs. */
export function reads() {
  const n = Math.floor(Math.random() * ATTENDEES);
  const params = {
    headers: {
      Cookie: `${COOKIE}=${session.tokens[n]}`,
      "X-Forwarded-For": addressOf(n),
    },
  };
  const base = `${API}/api/v1/public/events/${session.slug}`;
  for (const path of ["", "/me", "/chat/messages", "/questions"]) {
    const response = http.get(`${base}${path}`, {
      ...params,
      tags: { name: `GET /public/events/:slug${path}` },
    });
    check(response, { "read answered 200": (r) => r.status === 200 });
  }
}

/** A version 4 UUID (crypto.randomUUID is not in k6). */
function uuid() {
  const hex = [...Array(32)].map(() =>
    Math.floor(Math.random() * 16).toString(16),
  );
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
