mock_provider "aws" {}

run "tags_never_move_and_every_push_is_scanned" {
  command = plan

  assert {
    condition     = alltrue([for r in aws_ecr_repository.this : r.image_tag_mutability == "IMMUTABLE"])
    error_message = "A commit's tag must always mean the same image (rollback deploys a SHA)."
  }
  assert {
    condition     = alltrue([for r in aws_ecr_repository.this : r.image_scanning_configuration[0].scan_on_push])
    error_message = "Every push is scanned."
  }
}
