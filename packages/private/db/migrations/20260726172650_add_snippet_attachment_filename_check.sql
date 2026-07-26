-- Modify "snippets" table
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_attachment_filename_requires_url_check" CHECK ((attachment_filename IS NULL) OR (attachment_url IS NOT NULL));
