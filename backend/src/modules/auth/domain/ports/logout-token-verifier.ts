/** Puerto de verificacion del logout_token de back-channel logout. */
export type LogoutTokenVerifier = {
  verifyLogout(token: string): Promise<{ providerSessionId: string }>;
};
