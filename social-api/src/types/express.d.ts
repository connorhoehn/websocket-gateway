interface UserContext {
  sub: string;       // Cognito user ID
  email?: string;
}

declare namespace Express {
  interface Request {
    user?: UserContext;
  }
}
