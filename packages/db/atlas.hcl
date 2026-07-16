variable "database_url" {
  type    = string
  default = getenv("DATABASE_URL")
}

env "local" {
  src = "file://schema/schema.sql"
  url = var.database_url

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
