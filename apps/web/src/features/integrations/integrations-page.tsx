"use client";

import { Workspace } from "@goliveboard/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

import { useMe } from "../shell/me-context";
import { Deliveries } from "./deliveries";
import { EndpointForm } from "./endpoint-form";
import { EndpointsList } from "./endpoints-list";
import { integrationKeys } from "./keys";
import { SecretNotice } from "./secret-notice";

/** Webhooks (FR-RC-2): Owners only, as in the API. */
export function IntegrationsPage() {
  const me = useMe();
  const [secret, setSecret] = useState<string | undefined>();
  const [selected, setSelected] = useState<string | undefined>();
  if (me.activeWorkspace.role !== "OWNER") {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p>Only the workspace&apos;s Owners manage webhooks.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-10">
      <section aria-labelledby="endpoints-heading" className="grid gap-4">
        <h1
          id="endpoints-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Integrations
        </h1>
        <p className="text-muted-foreground">
          GoLiveBoard sends a signed POST to each endpoint when what it
          subscribes to happens, and retries for about two hours.
        </p>
        {secret === undefined ? null : (
          <SecretNotice
            secret={secret}
            onDone={() => {
              setSecret(undefined);
            }}
          />
        )}
        <EndpointsList
          selected={selected}
          onSelect={setSelected}
          onSecret={setSecret}
        />
      </section>
      {selected === undefined ? null : (
        <section aria-labelledby="deliveries-heading" className="grid gap-4">
          <h2 id="deliveries-heading" className="text-lg font-semibold">
            Deliveries
          </h2>
          <Deliveries endpointId={selected} />
        </section>
      )}
      <section aria-labelledby="add-heading" className="grid gap-4">
        <h2 id="add-heading" className="text-lg font-semibold">
          Add an endpoint
        </h2>
        <EndpointForm onCreated={setSecret} />
      </section>
      <PersonalData />
    </div>
  );
}

function PersonalData() {
  const { workspaceId } = useMe().activeWorkspace;
  const queryClient = useQueryClient();
  const workspace = useQuery({
    queryKey: integrationKeys.workspace(workspaceId),
    queryFn: ({ signal }) =>
      api("/workspace", { schema: Workspace, workspaceId, signal }),
  });
  const change = useMutation({
    mutationFn: (include: boolean) =>
      api("/workspace", {
        method: "PATCH",
        body: { webhooksIncludePersonalData: include },
        schema: Workspace,
        workspaceId,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(integrationKeys.workspace(workspaceId), updated);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <section aria-labelledby="privacy-heading" className="grid gap-2">
      <h2 id="privacy-heading" className="text-lg font-semibold">
        Personal data
      </h2>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          disabled={workspace.data === undefined || change.isPending}
          checked={workspace.data?.webhooksIncludePersonalData ?? false}
          onChange={(event) => {
            change.mutate(event.target.checked);
          }}
        />
        <span>
          Include the attendee&apos;s name and email address in
          attendee.registered webhooks.
          <span className="block text-sm text-muted-foreground">
            Off by default. Never sent for an attendee who has asked to be
            erased.
          </span>
        </span>
      </label>
    </section>
  );
}
