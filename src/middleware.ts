import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: ['/internal-dashboard-9a8f7e6d/:path*'],
};
