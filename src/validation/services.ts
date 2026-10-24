import { z } from "zod";
import { parseWithSchema } from "./common";

const serviceNameSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(80, "name must be at most 80 characters"),
  })
  .strict();

export function parseServiceName(body: unknown) {
  return parseWithSchema(serviceNameSchema, body);
}
