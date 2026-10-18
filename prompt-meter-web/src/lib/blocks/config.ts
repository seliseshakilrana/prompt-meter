export const blocksConfig = {
  apiUrl: (import.meta.env.VITE_BLOCKS_API_URL as string) || "https://blocksapi.slsblx.com",
  appDomain: (import.meta.env.VITE_BLOCKS_APP_DOMAIN as string) || "https://dbbvxg-eptqw.slsblx.com",
  oidcUrl: (import.meta.env.VITE_BLOCKS_OIDC_URL as string) || "https://iam.seliseblocks.com",
  oidcClientId: (import.meta.env.VITE_BLOCKS_OIDC_CLIENT_ID as string) || "e140c37a-1cc3-4edc-b77b-e00edcac0f97",
  oidcScope: (import.meta.env.VITE_BLOCKS_OIDC_SCOPE as string) || "openid profile",
  // This project's tenant id -- sent as the x-blocks-key header on every
  // Blocks API call, and as tenant_id on the OIDC login request.
  xBlocksKey: (import.meta.env.VITE_BLOCKS_X_BLOCKS_KEY as string) || "D056c99a5cd2a47b4bcf702d8874cf280"
};

export function isBlocksConfigured(): boolean {
  return Boolean(blocksConfig.apiUrl && blocksConfig.xBlocksKey && blocksConfig.appDomain);
}

export function isLoginConfigured(): boolean {
  return Boolean(blocksConfig.apiUrl && blocksConfig.oidcUrl && blocksConfig.oidcClientId);
}

// Connected AI accounts (features/accounts). The OAuth client ids are public; the same
// ids go into infra/blocks/workflows/link-config.json so the workflow checks the audience.
export const linkingConfig = {
  // "on" locks My usage until the user has connected at least one tool account.
  // Keep it "off" until the link workflows and the LinkedAccount schema are live.
  enabled: import.meta.env.VITE_PM_ACCOUNT_LINKING === "on",
  googleClientId: (import.meta.env.VITE_PM_GOOGLE_CLIENT_ID as string) || "",
  microsoftClientId: (import.meta.env.VITE_PM_MICROSOFT_CLIENT_ID as string) || "",
  // TODO(live): the URL a published webhook workflow answers on is not documented; set
  // this to the base the workflow list shows (the path segment is appended, e.g. /link-start).
  webhookBase: ((import.meta.env.VITE_PM_WORKFLOW_WEBHOOK_BASE as string) || "").replace(/\/+$/, "")
};
