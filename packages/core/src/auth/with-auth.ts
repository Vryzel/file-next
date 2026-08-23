/**
 * withAuth — opt-in request wrapper. Resolves the caller; 401 if null.
 * Server actions use getAuth() instead (no Request in the RSC path).
 */
import type { TenantId, UserId } from "@/types/branded";

export interface AuthContext {
  readonly tenantId: TenantId;
  readonly userId: UserId;
}

export const withAuth = <C extends AuthContext, R = Response>(
  resolve: (req: Request) => Promise<C | null>,
  handler: (ctx: C, req: Request) => Promise<R>,
): ((req: Request) => Promise<R | Response>) => {
  return async (req: Request): Promise<R | Response> => {
    const ctx = await resolve(req);
    if (ctx === null) {
      return Response.json(
        {
          ok: false,
          error: { code: "Unauthorized", message: "Not authenticated" },
        },
        { status: 401 },
      );
    }
    return handler(ctx, req);
  };
};
