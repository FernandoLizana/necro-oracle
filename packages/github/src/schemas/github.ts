import { RepoRefSchema } from "@necro/oracle";
import { z } from "zod";

export const Sha40Schema = z.string().regex(/^[0-9a-f]{40}$/);

/** The oracle's RepoRefSchema only requires min(1); the Summoner guarantees more (R2.4). */
export const ResolvedRepoRefSchema = RepoRefSchema.extend({ sha: Sha40Schema });

export const OwnerOrNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_.-]+$/)
  .refine((s) => s !== "." && s !== "..");

/** Header-injection guard. The value is never echoed in an error. */
export const GithubTokenSchema = z.string().min(1).regex(/^[^\s\x00-\x1f\x7f]+$/);

const IsoDate = z.string().datetime({ offset: true });

/**
 * Canonical identity (R2.4): owner.login + name are the canonical spelling.
 * full_name must equal `${owner.login}/${name}`.
 */
export const GhRepoSchema = z
  .object({
    name: OwnerOrNameSchema,
    full_name: z.string().min(1),
    owner: z.object({ login: OwnerOrNameSchema }),
    default_branch: z.string().min(1),
    private: z.boolean(),
    archived: z.boolean(),
    pushed_at: IsoDate.nullish().transform((v) => v ?? null),
    stargazers_count: z.number().int().nonnegative(),
    open_issues_count: z.number().int().nonnegative(),
    license: z
      .object({ spdx_id: z.string().nullable() })
      .nullish()
      .transform((v) => v ?? null),
  })
  .refine((r) => r.full_name === `${r.owner.login}/${r.name}`);
export type GhRepo = z.infer<typeof GhRepoSchema>;

export const GhCommitSchema = z.object({ sha: Sha40Schema });

export const GhPullsSchema = z.array(z.object({ created_at: IsoDate }));

export const GhReleaseSchema = z.object({
  published_at: IsoDate.nullish().transform((v) => v ?? null),
});

/** Best-effort hint used only by the failure mapper; failure to parse is not an error. */
export const GhErrorBodySchema = z.object({ message: z.string().optional() });
