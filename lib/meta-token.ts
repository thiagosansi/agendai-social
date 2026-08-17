export type TokenLevel = "green" | "amber" | "red";

export interface TokenStatus {
  level: TokenLevel;
  message: string;
}

export function tokenStatus(expiresAt: string | undefined): TokenStatus {
  if (!expiresAt) {
    return { level: "red", message: "META_TOKEN_EXPIRES_AT não configurada." };
  }

  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) {
    return { level: "red", message: "META_TOKEN_EXPIRES_AT tem um valor inválido." };
  }

  const daysLeft = Math.ceil((expires.getTime() - Date.now()) / 86_400_000);

  if (daysLeft < 0) {
    return { level: "red", message: `Token expirado há ${Math.abs(daysLeft)} dia(s).` };
  }
  if (daysLeft === 0) {
    return { level: "red", message: "Token expira hoje." };
  }
  if (daysLeft <= 10) {
    return { level: "amber", message: `Expira em ${daysLeft} dia(s).` };
  }
  return { level: "green", message: `Expira em ${daysLeft} dia(s).` };
}
