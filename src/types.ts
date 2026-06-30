export type Role = 'admin' | 'board' | 'management' | 'vendor' | 'resident';
export type Status = 'not_started' | 'in_progress' | 'overdue' | 'blocked' | 'complete';
export type Priority = 'urgent' | 'high' | 'normal' | 'low';
export type ResponsibilityGroup = 'board' | 'management' | 'vendor' | 'joint' | 'individual';
export type LinkType = 'related' | 'blocks' | 'blocked_by';
export type AttachmentSource = 'r2' | 'google_drive';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  created_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Attachment {
  id: string;
  task_id: number;
  uploaded_by: string;
  uploaded_by_name: string;
  filename: string;
  mime_type: string;
  size_bytes: number | null;
  source: AttachmentSource;
  url?: string;
  drive_file_id?: string;
  drive_web_view_link?: string;
  drive_download_url?: string;
  drive_icon_url?: string;
  created_at: string;
}

export interface Comment {
  id: string;
  task_id: number;
  user_id: string | null;
  user_name: string | null;
  content: string;
  is_system: boolean;
  created_at: string;
}

export interface Approval {
  id: string;
  task_id: number;
  user_id: string;
  user_name: string;
  vote: 'approve' | 'decline';
  note: string | null;
  voted_at: string;
}

export interface TaskLink {
  task_id: number;
  linked_task_id: number;
  linked_task_title: string;
  link_type: LinkType;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  responsibility_group: ResponsibilityGroup;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  due_date: string | null;
  awaiting_board: boolean;
  awaiting_board_text: string | null;
  board_direction: string | null;
  board_direction_date: string | null;
  board_direction_by: string | null;
  estimated_cost: number | null;
  approved_budget: number | null;
  is_recurring: boolean;
  recurrence_rule: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  tags: Tag[];
  comment_count: number;
  unread_count?: number;
  subscriber_count: number;
  is_subscribed?: boolean;
  attachments?: Attachment[];
  comments?: Comment[];
  links?: TaskLink[];
  approvals?: Approval[];
}

export type ResidentType = 'owner' | 'tenant';

export interface ResidentVehicle {
  id: string;
  resident_id: string;
  make: string | null;
  model: string | null;
  color: string | null;
  license_plate: string | null;
  parking_spot: string | null;
  synced_at: string | null;
  created_at: string;
}

export interface Resident {
  id: string;
  unit: string;
  name: string;
  email: string | null;
  phone: string | null;
  resident_type: ResidentType;
  move_in_date: string | null;
  notes: string | null;
  roster_synced_at: string | null;
  created_at: string;
  updated_at: string;
  vehicles: ResidentVehicle[];
}

