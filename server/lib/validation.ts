export class ValidationError extends Error {}

export function readString(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw new ValidationError(`${field}格式不正确`);
  }
  return value.trim();
}

export function validateUsername(value: unknown) {
  const username = readString(value, "用户名");
  if (
    username.length < 2 ||
    username.length > 32 ||
    !/^[\p{L}\p{N}_.-]+$/u.test(username)
  ) {
    throw new ValidationError("用户名须为 2-32 位文字、字母、数字或 _.-");
  }
  return username;
}

export function validatePassword(value: unknown) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new ValidationError("密码须为 8-128 位字符");
  }
  return value;
}

export async function readJsonBody(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new ValidationError("请求格式不正确");
  }
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new ValidationError("请求内容不是有效 JSON");
  }
}
