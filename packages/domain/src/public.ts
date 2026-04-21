import { z } from 'zod';

export const GlobalRoleEnum = z.enum(['Pending', 'Active', 'Admin']);
export const ProjectRoleEnum = z.enum(['ProjectAdmin', 'Editor', 'Viewer']);
export const ModuleNameEnum = z.enum(['iss', 'idx', 'drawings']);
export const ModuleAccessEnum = z.enum(['None', 'Viewer', 'Editor', 'Admin']);

/**
 * Project code format: single letter prefix (e=execution, p=proposal) + 6 digits.
 * Mirrors the `project_code_format_chk` CHECK constraint on public.project.
 */
export const PROJECT_CODE_REGEX = /^[ep]\d{6}$/;
export const projectCodeSchema = z
  .string()
  .regex(PROJECT_CODE_REGEX, 'Project code 형식: e|p + 숫자 6자리 (예: e230350)');

export const ProjectSchema = z.object({
  project_id: z.number().int().positive(),
  project_code: projectCodeSchema,
  project_name: z.string().min(1),
  description: z.string().nullable().optional(),
  created_at: z.string().datetime().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  display_name: z.string().nullable().optional(),
  role: GlobalRoleEnum,
  username: z.string().nullable().optional(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const UserProjectRoleSchema = z.object({
  id: z.coerce.number().optional(),
  user_id: z.string().uuid(),
  project_id: z.number().int().positive(),
  role: ProjectRoleEnum,
  assigned_at: z.string().datetime().optional(),
  assigned_by: z.string().uuid().nullable().optional(),
});
export type UserProjectRole = z.infer<typeof UserProjectRoleSchema>;

export const UserProjectModuleSchema = z.object({
  id: z.coerce.number().optional(),
  user_id: z.string().uuid(),
  project_id: z.number().int().positive(),
  module: ModuleNameEnum,
  access: ModuleAccessEnum,
  assigned_at: z.string().datetime().optional(),
});
export type UserProjectModule = z.infer<typeof UserProjectModuleSchema>;

/**
 * Tag_core_field mirrors the allowed values in idx.index_column.tag_core_field.
 * These are the normalized columns on public.tag that the
 * idx_record_sync_to_tag trigger maintains.
 */
export const TagCoreFieldEnum = z.enum([
  'tag_number',
  'service_description',
  'instrument_type',
  'signal_type',
  'io_type',
  'loop_number',
  'pnid_number',
  'location',
  'ex_rating',
  'ex_certification',
]);
export type TagCoreField = z.infer<typeof TagCoreFieldEnum>;

export const TagSchema = z.object({
  tag_id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  tag_number: z.string().min(1),
  service_description: z.string().nullable().optional(),
  instrument_type: z.string().nullable().optional(),
  signal_type: z.string().nullable().optional(),
  io_type: z.string().nullable().optional(),
  loop_number: z.string().nullable().optional(),
  pnid_number: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  ex_rating: z.string().nullable().optional(),
  ex_certification: z.string().nullable().optional(),
  source_record_id: z.number().int().nullable().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});
export type Tag = z.infer<typeof TagSchema>;

export const LoopSchema = z.object({
  loop_id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  loop_number: z.string().min(1),
  description: z.string().nullable().optional(),
  created_at: z.string().datetime().optional(),
});
export type Loop = z.infer<typeof LoopSchema>;
