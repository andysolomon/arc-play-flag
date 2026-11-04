terraform {
  required_version = ">= 1.14, < 2.0"

  # Use local execution: HCP holds and locks state; credentials stay in the CLI session.
  cloud {
    organization = "natgeo_andysolomon"

    workspaces {
      name = "arc-play-flag-infrastructure"
    }
  }

  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "~> 5.24.1"
    }
  }
}

# VERCEL_API_TOKEN supplies authentication; never store credentials in this file.
provider "vercel" {
  team = "team_1h9Xca1fcyThRFdpK9runicq"
}

# Adopt the existing project. vercel.json owns framework/build configuration;
# the Marketplace integration owns database resources and generated variables.
import {
  to = vercel_project.app
  id = "team_1h9Xca1fcyThRFdpK9runicq/prj_E2RpFSkEDMnfpXuhUfISNTUzBuaf"
}

resource "vercel_project" "app" {
  name         = "arc-play-flag"
  node_version = "24.x"

  git_repository = {
    type              = "github"
    repo              = "andysolomon/arc-play-flag"
    production_branch = "main"
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "vercel_project_id" {
  value = vercel_project.app.id
}
