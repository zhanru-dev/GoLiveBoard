# Image repositories (docs/06, section 5): tags are commit SHAs and never
# move (immutable), every push is scanned, and the last 20 images are kept,
# enough to roll back weeks while keeping storage small.

resource "aws_ecr_repository" "this" {
  # checkov:skip=CKV_AWS_136: AES-256 at rest by default; a customer-managed key adds cost, not protection here.
  for_each             = toset(var.repositories)
  name                 = each.value
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 20 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}
