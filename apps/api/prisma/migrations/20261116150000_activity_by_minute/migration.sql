-- Messages and questions per minute, for the operations room and the report.
CREATE INDEX "chat_messages_event_id_created_at_idx" ON "chat_messages"("event_id", "created_at");

CREATE INDEX "questions_event_id_created_at_idx" ON "questions"("event_id", "created_at");
