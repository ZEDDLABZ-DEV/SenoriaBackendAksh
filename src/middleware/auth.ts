import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { asyncHandler } from "../http/asyncHandler";
import { attachUser } from "../http/requestContext";
import { AppError, forbidden, unauthenticated } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { verifyAccessToken, type UserRole } from "../lib/tokens";

export function requireRoles(roles: UserRole[]) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      throw unauthenticated();
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      throw unauthenticated();
    }
    try {
      const claims = verifyAccessToken(token);
      const user = await prisma.user.findUnique({ where: { id: claims.sub } });
      if (!user || user.status !== "active") {
        throw unauthenticated();
      }
      if (user.role !== "CAREGIVER" && user.role !== "ADMIN") {
        throw unauthenticated();
      }
      if (!roles.includes(user.role)) {
        throw forbidden();
      }
      attachUser(req, {
        id: user.id,
        role: user.role,
        email: user.email,
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw unauthenticated();
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2023") {
        throw unauthenticated();
      }
      throw error;
    }
    next();
  });
}
