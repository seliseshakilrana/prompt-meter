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
