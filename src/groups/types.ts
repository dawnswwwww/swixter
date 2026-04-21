import { z } from "zod";

export interface Group {
  id: string;
  name: string;
  profiles: string[];      // Profile IDs in priority order (index 0 = highest)
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export const GroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  profiles: z.array(z.string()).min(1),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
