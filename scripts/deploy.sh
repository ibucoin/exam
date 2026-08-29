#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || ! printf '%s' "$1" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "用法：deploy.sh <40 位 commit SHA>" >&2
  exit 2
fi

new_tag=$1
deploy_dir=/opt/code/exam
data_dir=/opt/code/exam/data
backup_root=/opt/code/exam/backups
compose_file="$deploy_dir/docker-compose.yml"
env_file="$deploy_dir/.env"

if [ ! -f "$env_file" ]; then
  echo "$env_file 不存在，请先配置 IMAGE_TAG、ADMIN_USERNAME 和 ADMIN_PASSWORD" >&2
  exit 1
fi

old_tag=$(sed -n 's/^IMAGE_TAG=//p' "$env_file" | tail -n 1)
if [ -z "$old_tag" ]; then
  echo "$env_file 缺少 IMAGE_TAG" >&2
  exit 1
fi

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

set_image_tag() {
  replacement_tag=$1
  temporary_file=$(mktemp "${env_file}.XXXXXX")
  awk -v tag="$replacement_tag" '
    BEGIN { replaced = 0 }
    /^IMAGE_TAG=/ {
      print "IMAGE_TAG=" tag
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) print "IMAGE_TAG=" tag
    }
  ' "$env_file" > "$temporary_file"
  chmod --reference="$env_file" "$temporary_file"
  mv "$temporary_file" "$env_file"
}

rollback() {
  echo "发布失败，回滚到镜像 $old_tag" >&2
  set_image_tag "$old_tag"
  compose up -d --no-deps exam
}

install -d -m 0750 "$deploy_dir" "$data_dir" "$backup_root"
chown -R 1000:1000 "$data_dir"

set_image_tag "$new_tag"
if ! compose pull exam; then
  set_image_tag "$old_tag"
  exit 1
fi

if ! compose stop exam; then
  set_image_tag "$old_tag"
  exit 1
fi

backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
if ! cp -a "$data_dir/." "$backup_dir/"; then
  rollback
  exit 1
fi

if ! compose up -d --no-deps exam; then
  rollback
  exit 1
fi

attempt=0
while [ "$attempt" -lt 60 ]; do
  if ! container_id=$(compose ps -q exam); then
    break
  fi
  if [ -n "$container_id" ]; then
    if ! health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id"); then
      break
    fi
    case "$health" in
      healthy)
        echo "发布成功：$new_tag"
        exit 0
        ;;
      unhealthy|exited|dead)
        break
        ;;
    esac
  fi
  attempt=$((attempt + 1))
  sleep 2
done

compose logs --tail 100 exam >&2 || true
rollback
exit 1
