import { Request } from 'express';

export interface UserContext {
  sub: string;       // Cognito user ID
  email?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: UserContext;
    }
  }
}
