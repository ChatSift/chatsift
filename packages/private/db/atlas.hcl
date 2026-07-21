variable "database_url" {
  type    = string
  default = getenv("DATABASE_URL_DEV")
}

env "local" {
  src = "file://schema/schema.sql"
  # The local docker-compose postgres doesn't have TLS enabled; sslmode=disable is only safe to
  # hardcode here because this is the "local" env specifically, not a prod one.
  url = "${var.database_url}?sslmode=disable"

  # Used by `atlas migrate diff` / `atlas migrate lint` to compute a clean diff against an
  # ephemeral database rather than the real dev DB.
  dev = "docker://postgres/17/dev?search_path=public"

  migration {
    dir = "file://migrations"
  }

  format {
    migrate {
      diff = "{{ sql . \"  \" }}"
    }
  }
}
