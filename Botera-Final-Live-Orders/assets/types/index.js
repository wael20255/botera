// ============================================================================
// types/index — shape documentation for every entity in the app, as JSDoc
// typedefs. This is a vanilla-JS project with no build step, so these are
// not enforced at runtime (there's no TypeScript compiler) — they exist so
// editors can still offer autocomplete/hover docs, and so every service's
// return shape is written down in exactly one place. This file has no
// executable code and does not need to be <script>-included anywhere.
// ============================================================================

/**
 * @typedef {Object} Company
 * @property {string} id
 * @property {string} name
 * @property {string|null} logo
 * @property {string} industry
 * @property {string} country
 * @property {string} timezone
 * @property {string} currency
 * @property {string} language
 * @property {string} created_at
 */

/**
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} company_id
 * @property {string} full_name
 * @property {"owner"|"employee"} role
 * @property {boolean} is_platform_owner
 * @property {boolean} can_view_conversations
 * @property {boolean} can_view_customers
 * @property {boolean} can_view_orders
 * @property {boolean} can_view_insights
 * @property {boolean} can_view_automation
 * @property {boolean} can_view_settings
 * @property {boolean} can_manage_team
 * @property {Company} [company]
 */

/**
 * @typedef {Object} Customer
 * @property {string} id
 * @property {string} company_id
 * @property {string} name
 * @property {string|null} phone
 * @property {"whatsapp"|"instagram"|"facebook"|"messenger"|"tiktok"} channel
 * @property {"new"|"asking"|"hesitant"|"ready"|"closed"|"lost"} stage
 * @property {string} created_at
 */

/**
 * @typedef {Object} Conversation
 * @property {string} id
 * @property {string} company_id
 * @property {string} customer_id
 * @property {string} channel
 * @property {boolean} ai_handled
 * @property {string|null} last_message_preview
 * @property {string|null} last_message_at
 * @property {number} unread_count
 */

/**
 * @typedef {Object} Message
 * @property {string} id
 * @property {string} conversation_id
 * @property {"customer"|"agent"|"ai"} sender
 * @property {string} body
 * @property {string} created_at
 */

/**
 * @typedef {Object} OrderLineItem
 * @property {string} name
 * @property {number} quantity
 * @property {number} unit_price
 * @property {number} [unit_cost]
 */

/**
 * @typedef {Object} Order
 * @property {string} id
 * @property {string} company_id
 * @property {string} code
 * @property {string} customer_id
 * @property {string|null} conversation_id
 * @property {OrderLineItem[]} items
 * @property {number} subtotal
 * @property {number} shipping_fee
 * @property {number} discount
 * @property {number} tax
 * @property {number} total
 * @property {number} cost_total
 * @property {string} currency
 * @property {"pending"|"confirmed"|"processing"|"shipped"|"delivered"|"cancelled"|"refunded"} status
 * @property {"unpaid"|"paid"|"refunded"|"failed"} payment_status
 * @property {"cod"|"card"|"wallet"|"transfer"} payment_method
 * @property {string} channel
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} Product
 * @property {string} id
 * @property {string} company_id
 * @property {string} name
 * @property {string|null} sku
 * @property {number} price
 * @property {number} cost
 * @property {string|null} image_url
 * @property {string} created_at
 */

/**
 * @typedef {Object} Campaign
 * @property {string} id
 * @property {string} company_id
 * @property {string} name
 * @property {string|null} platform
 * @property {string} status
 * @property {number} budget
 * @property {number} spend
 * @property {number} revenue
 * @property {number|null} roas
 * @property {string|null} start_date
 * @property {string|null} end_date
 */

/**
 * @typedef {Object} AutomationRecommendation
 * @property {string} id
 * @property {string} company_id
 * @property {string} title
 * @property {"Critical"|"High"|"Medium"|"Low"} priority
 * @property {string} category
 * @property {string} recommendation
 * @property {string} reason
 * @property {string} impact
 * @property {"Pending"|"Applied"|"Dismissed"} status
 * @property {number} confidence
 * @property {boolean} completed
 * @property {string} created_at
 */

/**
 * @typedef {Object} Notification
 * @property {string} id
 * @property {string} company_id
 * @property {string} type
 * @property {string} title
 * @property {string|null} body
 * @property {boolean} is_read
 * @property {string} created_at
 */
