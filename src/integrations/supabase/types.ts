export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      contact_processing_logs: {
        Row: {
          code: string
          contact_id: string | null
          created_at: string
          details: Json
          event_id: string | null
          id: string
          launch_id: string
          level: string
          message: string
          source: string
          title: string
        }
        Insert: {
          code: string
          contact_id?: string | null
          created_at?: string
          details?: Json
          event_id?: string | null
          id?: string
          launch_id: string
          level: string
          message: string
          source: string
          title: string
        }
        Update: {
          code?: string
          contact_id?: string | null
          created_at?: string
          details?: Json
          event_id?: string | null
          id?: string
          launch_id?: string
          level?: string
          message?: string
          source?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_processing_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "lead_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_processing_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "inbound_contact_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_processing_logs_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_routing_actions: {
        Row: {
          action_key: string | null
          action_type: string
          contact_id: string | null
          created_at: string
          error_message: string | null
          event_id: string | null
          id: string
          launch_id: string
          request_payload: Json
          response_payload: Json
          source: string
          status: string
          target: string
          updated_at: string
        }
        Insert: {
          action_key?: string | null
          action_type: string
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          event_id?: string | null
          id?: string
          launch_id: string
          request_payload?: Json
          response_payload?: Json
          source: string
          status?: string
          target: string
          updated_at?: string
        }
        Update: {
          action_key?: string | null
          action_type?: string
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          event_id?: string | null
          id?: string
          launch_id?: string
          request_payload?: Json
          response_payload?: Json
          source?: string
          status?: string
          target?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_routing_actions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "lead_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_routing_actions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "inbound_contact_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_routing_actions_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_contact_events: {
        Row: {
          event_type: string
          external_contact_id: string | null
          id: string
          launch_id: string
          payload: Json
          processed_at: string | null
          processed_contact_id: string | null
          processing_status: string
          processing_summary: Json
          received_at: string
          source: string
        }
        Insert: {
          event_type: string
          external_contact_id?: string | null
          id?: string
          launch_id: string
          payload?: Json
          processed_at?: string | null
          processed_contact_id?: string | null
          processing_status?: string
          processing_summary?: Json
          received_at?: string
          source: string
        }
        Update: {
          event_type?: string
          external_contact_id?: string | null
          id?: string
          launch_id?: string
          payload?: Json
          processed_at?: string | null
          processed_contact_id?: string | null
          processing_status?: string
          processing_summary?: Json
          received_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_contact_events_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_contact_events_processed_contact_id_fkey"
            columns: ["processed_contact_id"]
            isOneToOne: false
            referencedRelation: "lead_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_dedupe_settings: {
        Row: {
          auto_add_country_code: boolean
          auto_add_ninth_digit: boolean
          auto_merge_duplicates: boolean
          compare_digits_only: boolean
          created_at: string
          default_country_code: string
          launch_id: string
          merge_on_exact_email: boolean
          merge_on_exact_phone: boolean
          prefer_most_complete_record: boolean
          updated_at: string
        }
        Insert: {
          auto_add_country_code?: boolean
          auto_add_ninth_digit?: boolean
          auto_merge_duplicates?: boolean
          compare_digits_only?: boolean
          created_at?: string
          default_country_code?: string
          launch_id: string
          merge_on_exact_email?: boolean
          merge_on_exact_phone?: boolean
          prefer_most_complete_record?: boolean
          updated_at?: string
        }
        Update: {
          auto_add_country_code?: boolean
          auto_add_ninth_digit?: boolean
          auto_merge_duplicates?: boolean
          compare_digits_only?: boolean
          created_at?: string
          default_country_code?: string
          launch_id?: string
          merge_on_exact_email?: boolean
          merge_on_exact_phone?: boolean
          prefer_most_complete_record?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_dedupe_settings_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: true
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_uchat_workspaces: {
        Row: {
          created_at: string
          current_count: number
          id: string
          launch_id: string
          max_subscribers: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          current_count?: number
          id?: string
          launch_id: string
          max_subscribers?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          current_count?: number
          id?: string
          launch_id?: string
          max_subscribers?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_uchat_workspaces_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_uchat_workspaces_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "uchat_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      launches: {
        Row: {
          ac_api_key: string | null
          ac_api_url: string | null
          ac_default_automation_id: string | null
          ac_default_list_id: string | null
          ac_named_tags: Json
          created_at: string
          created_by: string
          custom_states: Json
          id: string
          manychat_account_id: string | null
          manychat_api_key: string | null
          manychat_api_url: string | null
          name: string
          project_id: string | null
          slug: string | null
          status: string
          webhook_secret: string
          whatsapp_group_link: string | null
        }
        Insert: {
          ac_api_key?: string | null
          ac_api_url?: string | null
          ac_default_automation_id?: string | null
          ac_default_list_id?: string | null
          ac_named_tags?: Json
          created_at?: string
          created_by: string
          custom_states?: Json
          id?: string
          manychat_account_id?: string | null
          manychat_api_key?: string | null
          manychat_api_url?: string | null
          name: string
          project_id?: string | null
          slug?: string | null
          status?: string
          webhook_secret?: string
          whatsapp_group_link?: string | null
        }
        Update: {
          ac_api_key?: string | null
          ac_api_url?: string | null
          ac_default_automation_id?: string | null
          ac_default_list_id?: string | null
          ac_named_tags?: Json
          created_at?: string
          created_by?: string
          custom_states?: Json
          id?: string
          manychat_account_id?: string | null
          manychat_api_key?: string | null
          manychat_api_url?: string | null
          name?: string
          project_id?: string | null
          slug?: string | null
          status?: string
          webhook_secret?: string
          whatsapp_group_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "launches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_contact_identities: {
        Row: {
          contact_id: string
          created_at: string
          external_contact_id: string | null
          external_email: string | null
          external_phone: string | null
          id: string
          launch_id: string
          normalized_phone: string | null
          raw_snapshot: Json
          source: string
          updated_at: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          external_contact_id?: string | null
          external_email?: string | null
          external_phone?: string | null
          id?: string
          launch_id: string
          normalized_phone?: string | null
          raw_snapshot?: Json
          source: string
          updated_at?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          external_contact_id?: string | null
          external_email?: string | null
          external_phone?: string | null
          id?: string
          launch_id?: string
          normalized_phone?: string | null
          raw_snapshot?: Json
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_contact_identities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "lead_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_contact_identities_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_contacts: {
        Row: {
          created_at: string
          data: Json
          first_source: string | null
          id: string
          last_source: string | null
          launch_id: string
          merged_from_count: number
          normalized_phone: string | null
          primary_email: string | null
          primary_name: string | null
          primary_phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data?: Json
          first_source?: string | null
          id?: string
          last_source?: string | null
          launch_id: string
          merged_from_count?: number
          normalized_phone?: string | null
          primary_email?: string | null
          primary_name?: string | null
          primary_phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          first_source?: string | null
          id?: string
          last_source?: string | null
          launch_id?: string
          merged_from_count?: number
          normalized_phone?: string | null
          primary_email?: string | null
          primary_name?: string | null
          primary_phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_contacts_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_sync_runs: {
        Row: {
          created_count: number
          error_count: number
          finished_at: string | null
          id: string
          last_error: string | null
          launch_id: string
          merged_count: number
          metadata: Json
          processed_count: number
          skipped_count: number
          source: string
          started_at: string
          status: string
        }
        Insert: {
          created_count?: number
          error_count?: number
          finished_at?: string | null
          id?: string
          last_error?: string | null
          launch_id: string
          merged_count?: number
          metadata?: Json
          processed_count?: number
          skipped_count?: number
          source: string
          started_at?: string
          status?: string
        }
        Update: {
          created_count?: number
          error_count?: number
          finished_at?: string | null
          id?: string
          last_error?: string | null
          launch_id?: string
          merged_count?: number
          metadata?: Json
          processed_count?: number
          skipped_count?: number
          source?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_sync_runs_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          approval_reviewed_at: string | null
          approval_reviewed_by: string | null
          approval_status: string
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_admin: boolean
          must_change_password: boolean
          password_changed_at: string | null
          user_id: string
        }
        Insert: {
          approval_reviewed_at?: string | null
          approval_reviewed_by?: string | null
          approval_status?: string
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          is_admin?: boolean
          must_change_password?: boolean
          password_changed_at?: string | null
          user_id: string
        }
        Update: {
          approval_reviewed_at?: string | null
          approval_reviewed_by?: string | null
          approval_status?: string
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_admin?: boolean
          must_change_password?: boolean
          password_changed_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          ac_api_key: string | null
          ac_api_url: string | null
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string | null
          status: string
          whatsapp_group_link: string | null
        }
        Insert: {
          ac_api_key?: string | null
          ac_api_url?: string | null
          created_at?: string
          created_by: string
          id?: string
          name: string
          slug?: string | null
          status?: string
          whatsapp_group_link?: string | null
        }
        Update: {
          ac_api_key?: string | null
          ac_api_url?: string | null
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          slug?: string | null
          status?: string
          whatsapp_group_link?: string | null
        }
        Relationships: []
      }
      uchat_workspaces: {
        Row: {
          api_token: string
          bot_id: string | null
          created_at: string
          current_count: number
          default_tag_name: string | null
          id: string
          launch_id: string | null
          max_subscribers: number
          project_id: string | null
          welcome_subflow_ns: string | null
          workspace_id: string | null
          workspace_name: string
        }
        Insert: {
          api_token: string
          bot_id?: string | null
          created_at?: string
          current_count?: number
          default_tag_name?: string | null
          id?: string
          launch_id?: string | null
          max_subscribers?: number
          project_id?: string | null
          welcome_subflow_ns?: string | null
          workspace_id?: string | null
          workspace_name: string
        }
        Update: {
          api_token?: string
          bot_id?: string | null
          created_at?: string
          current_count?: number
          default_tag_name?: string | null
          id?: string
          launch_id?: string | null
          max_subscribers?: number
          project_id?: string | null
          welcome_subflow_ns?: string | null
          workspace_id?: string | null
          workspace_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "uchat_workspaces_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uchat_workspaces_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_launch_sources: { Args: { target_launch_id: string }; Returns: Json }
      is_approved_user: { Args: { _user_id: string }; Returns: boolean }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
      list_pending_signup_requests: {
        Args: never
        Returns: {
          created_at: string
          email: string
          full_name: string
          id: string
          must_change_password: boolean
          user_id: string
        }[]
      }
      replace_launch_uchat_workspaces: {
        Args: { next_workspaces?: Json; target_launch_id: string }
        Returns: Json
      }
      review_signup_request: {
        Args: { next_status: string; target_profile_id: string }
        Returns: {
          approval_reviewed_at: string | null
          approval_reviewed_by: string | null
          approval_status: string
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_admin: boolean
          must_change_password: boolean
          password_changed_at: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_launch_activecampaign_settings: {
        Args: {
          next_api_key?: string
          next_api_url?: string
          next_default_list_id?: string
          next_named_tags?: Json
          target_launch_id: string
        }
        Returns: Json
      }
      user_owns_launch: {
        Args: { _launch_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
