-- Create index "threads_mod_thread_id_idx" to table: "threads"
CREATE INDEX "threads_mod_thread_id_idx" ON "threads" ("mod_thread_id");
-- Create index "threads_user_thread_id_idx" to table: "threads"
CREATE INDEX "threads_user_thread_id_idx" ON "threads" ("user_thread_id") WHERE (user_thread_id IS NOT NULL);
