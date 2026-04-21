// Database type definitions matching Supabase schema

// Global role stored in user_profile.role
export type GlobalRole = 'Pending' | 'Active' | 'Admin';

// Project-level role stored in user_project_role.role
export type ProjectRole = 'ProjectAdmin' | 'Editor' | 'Viewer';

// Backward-compatibility alias
export type UserRole = GlobalRole;

export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  username: string | null;
  role: GlobalRole;
  created_at: string;
}

export interface UserProjectRole {
  id: number;
  user_id: string;
  project_id: number;
  role: ProjectRole;
  assigned_at: string;
  assigned_by: string | null;
}

export interface Tag {
  tag_id: number;
  tag_number: string;
}

export interface Template {
  template_id: number;
  template_code: string;
  template_name?: string | null;
}

export interface FieldDef {
  field_id: number;
  field_name: string;
  data_kind: string;
}

export interface Document {
  document_id: number;
  template_id: number;
  document_number: string;
  sheet_number: string | null;
  revision_number: string | null;
  minor_revision: string | null;
  tag_id: number | null;
  template?: Template;
}

export interface DocumentValue {
  document_id: number;
  field_id: number;
  value_text: string | null;
}

export interface DocumentRevision {
  revision_id: number;
  document_id: number;
  revision_number: string;
  revision_type: 'minor' | 'major';
  note: string | null;
  committed_at: string;
  committed_by: string | null;
}

export interface DocumentRevisionDetail {
  detail_id: number;
  revision_id: number;
  document_number: string;
  tag_number: string | null;
  field_name: string;
  previous_value: string | null;
  new_value: string | null;
  changed_at: string;
  changed_by: string | null;
}

export interface DocumentValueChange {
  document_id: number;
  field_id: number;
  tag_number: string | null;
  template_code: string | null;
  field_name: string | null;
  previous_value: string | null;
  new_value: string | null;
  changed_at: string;
  changed_by: string | null;
}

export interface MappingRule {
  mapping_id: number;
  template_id: number;
  field_id: number;
  data_type: string | null;
  target_sheet: string | null;
  target_cell: string | null;
  remark: string | null;
  field_def?: FieldDef;
  mapping_option?: MappingOption[];
}

export interface MappingOption {
  option_id: number;
  mapping_id: number;
  expected_value: string | null;
}

export interface BrowserRow {
  tag_id: number;
  tag_number: string;
  document_id: number;
  document_number: string;
  template_code: string;
  sheet_number: string | null;
  revision_number: string | null;
  minor_revision: string | null;
  field_values: Record<string, string>;
}

export interface FieldColumn {
  field_id: number;
  field_name: string;
  data_kind?: string;
}
