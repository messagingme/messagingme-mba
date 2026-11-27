/**
 * Les outils du serveur MCP, rangés par famille (Julien, 2026-10-21), pour le README du plugin, la page Boutiques Shopify
 * de la vitrine et la page Serveur MCP de la console, qui les lit d'ici (`web/lib/partage/`, comme le catalogue, depuis le
 * 2026-10-31). `tests/plugin-readme.test.ts`
 * exige que chaque outil du catalogue figure dans une famille, et dans une seule : un outil ajouté sans y être rangé rend
 * la CI rouge, au lieu de manquer en silence au README.
 * `titre` sert au README et aux pages anglaises, `titreFr` aux pages françaises.
 */
import type { NomOutilMcp } from './catalogue-mcp';

export const FAMILLES_OUTILS: ReadonlyArray<{ readonly titre: string; readonly titreFr: string; readonly outils: readonly NomOutilMcp[] }> = [
  { titre: 'Setup and plan', titreFr: 'Mise en service et offre', outils: ['get_setup_state', 'get_plan', 'subscribe_pro', 'take_credit_line', 'get_credit', 'buy_credit', 'create_api_key', 'list_members', 'contact_support'] },
  {
    titre: 'WhatsApp number', titreFr: 'Numéro WhatsApp',
    outils: ['start_whatsapp_connection', 'watch_whatsapp_connection', 'get_account_status', 'request_number_code', 'activate_number', 'get_number_subscription', 'manage_number_subscription', 'resubscribe_number', 'return_number_at_plan_end'],
  },
  {
    titre: 'AI agent', titreFr: 'Agent IA',
    outils: [
      'list_agents', 'get_agent', 'create_agent', 'update_agent', 'set_agent_limits', 'set_agent_tools', 'set_agent_action', 'delete_agent_action',
      'test_agent', 'activate_agent', 'set_default_responder', 'set_transfer_mode', 'set_business_hours',
      'list_agent_tool_library', 'update_agent_tool', 'list_agent_tests', 'get_settings_history', 'get_ai_disclosure',
      'set_ai_disclosure', 'get_agent_usage', 'delete_agent',
    ],
  },
  { titre: 'Agent knowledge', titreFr: 'Connaissance de l’agent IA', outils: ['list_knowledge', 'add_knowledge', 'update_knowledge', 'delete_knowledge', 'preview_site', 'import_site', 'import_document_text'] },
  {
    titre: 'Conversations', titreFr: 'Conversations',
    outils: [
      'list_conversations', 'get_conversation', 'get_messages', 'reply_in_open_window', 'send_message', 'control_conversation',
      'tag_conversation', 'assign_conversation', 'update_conversation', 'transcribe_message', 'get_message_media', 'get_inbox_settings',
      'update_inbox_settings', 'erase_conversation_messages', 'get_conversation_insights',
    ],
  },
  { titre: 'Templates', titreFr: 'Modèles', outils: ['list_templates', 'get_template_status', 'create_template', 'update_template', 'delete_template', 'send_template_to_contact', 'get_message_status'] },
  {
    titre: 'Contacts and campaigns', titreFr: 'Contacts et campagnes',
    outils: ['search_contacts', 'get_contact', 'create_contact', 'preview_contacts_import', 'import_contacts', 'get_contact_history', 'get_contact_report', 'export_contact_history', 'list_unsubscribed_contacts', 'list_possible_refusals', 'list_blocked_contacts', 'get_optout_push', 'set_optout_push', 'block_contact', 'prepare_contacts_deletion', 'delete_contacts', 'find_contacts', 'tag_contacts', 'list_tags', 'rename_tag', 'delete_tag', 'list_fields', 'create_field', 'update_field', 'delete_field', 'get_field_usage', 'set_contact_field', 'prepare_campaign', 'launch_campaign', 'control_campaign', 'list_scenarios', 'get_scenario', 'simulate_scenario', 'get_scenario_test_link', 'get_contact_journey', 'list_delivery_errors', 'list_system_errors', 'create_scenario', 'update_scenario', 'delete_scenario', 'send_scenario_to_contact', 'list_scenario_versions', 'propose_go_live', 'get_go_live'],
  },
  { titre: 'Chat bubble', titreFr: 'Bulle WhatsApp', outils: ['list_widgets', 'create_widget', 'update_widget'] },
  { titre: 'Shopify store', titreFr: 'Boutique Shopify', outils: ['connect_shopify', 'set_shopify_message', 'get_shopify_state', 'preview_shopify_customers', 'import_shopify_customers', 'preview_shopify_order_history', 'import_shopify_order_history', 'get_shopify_order_history', 'sync_shopify_customer_tags', 'disconnect_shopify'] },
  { titre: 'Webhooks', titreFr: 'Webhooks', outils: ['create_webhook_endpoint', 'list_webhook_endpoints', 'update_webhook_endpoint', 'delete_webhook_endpoint', 'send_test_event', 'get_webhook_deliveries', 'replay_webhook_delivery'] },
  { titre: 'Statistics', titreFr: 'Chiffres', outils: ['get_message_stats', 'get_campaign_stats', 'get_ai_stats', 'get_revenue_stats'] },
];
