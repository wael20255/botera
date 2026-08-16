# Botera HTML Dashboard

واجهة ثابتة (HTML + CSS + JavaScript خام فقط — بدون أي framework أو build step) متصلة بالكامل بـ **Supabase حقيقي**: مصادقة حقيقية، وقاعدة بيانات متعددة الشركات (multi-tenant) معزولة بالكامل على مستوى الـ RLS.

## 1) الإعداد (بالترتيب ده بالظبط)

1. في Supabase SQL Editor، نفّذ **الملفات بالترتيب ده بالظبط** (كل ملف بيبني على اللي قبله):
   - [`supabase/setup.sql`](supabase/setup.sql) — الجداول الأساسية (`companies`, `profiles`, وربط `customers`/`conversations`/`orders` بـ `company_id`) + سياسات العزل بين الشركات.
   - [`supabase/02-real-backend.sql`](supabase/02-real-backend.sql) — صلاحيات التسجيل الذاتي (Self-serve signup) + الجداول الجديدة: `notifications`, `products`, `campaigns`, `automation_recommendations` + عمود `orders.cost_total` (لحساب الربح الحقيقي).
   - [`supabase/03-register-transaction.sql`](supabase/03-register-transaction.sql) — عمود `profiles.role` + دالة `register_company` اللي بتنشئ الشركة وبروفايل المالك سوا في عملية واحدة (transaction) بدون ما تسيب أي بيانات ناقصة لو حصل خطأ في النص.
   - [`supabase/04-message-attachments.sql`](supabase/04-message-attachments.sql) — عمودين `messages.attachment_url` / `messages.attachment_type` (نص/بدون تأثير على الرسائل القديمة) + إنشاء storage bucket عام باسم `message-attachments` لحفظ الصور والتسجيلات الصوتية اللي بتتبعت من صفحة المحادثات، مع سياسة رفع مقيّدة بـ company_id لكل شركة.
   - [`supabase/05-recommendation-categories.sql`](supabase/05-recommendation-categories.sql) — قيد (CHECK constraint) على عمود `automation_recommendations.category` يحصره في 3 قيم بالظبط (`Ads` / `Growth` / `Customers`) — نفس الأقسام الـ 3 الظاهرة في صفحة الأتمتة.
   - [`supabase/06-integration-status.sql`](supabase/06-integration-status.sql) — جدول `integration_status` لعرض حالة اتصال حقيقية (متصل/متأخر/غير متصل) لكل أتمتة n8n في صفحة الإعدادات.
   - [`supabase/07-fixes-team-products.sql`](supabase/07-fixes-team-products.sql) — **مهم جدًا، لازم تشغّله حتى لو مشروعك شغّال بالفعل**: بيصلّح مشاكل التسجيل، التوصيات، تكاليف الشحن، صلاحيات الفريق والمنتجات، وكمان يضيف سياسة قراءة `order_items` اللازمة عشان صفحة الطلبات واختبار اتصال قاعدة البيانات يشتغلوا بدون خطأ RLS.
2. **لإدارة الفريق (owner يضيف موظفين)**: انشر Edge Function واحدة بالـ Supabase CLI:
   ```
   supabase functions deploy create-team-member
   ```
   محتاجة إنك تكون عامل `supabase login` و`supabase link --project-ref YOUR-PROJECT-REF` قبلها. مفيش أي secrets إضافية لازم تظبطها — `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` بيتحقنوا تلقائيًا في أي Edge Function. راجع التعليقات في [`supabase/functions/create-team-member/index.ts`](supabase/functions/create-team-member/index.ts) لتفاصيل ليه الخطوة دي لازم تكون Edge Function مش استعلام عادي من المتصفح.
3. من **Authentication → Providers**، تأكد إن Email/Password مفعّل. لو "Confirm email" مفعّلة (الإعداد الافتراضي)، أي شركة جديدة بتتسجل هتحتاج تأكيد الإيميل الأول قبل تسجيل الدخول — التطبيق بيوضح الرسالة دي تلقائيًا.
4. من **Authentication → URL Configuration**، أضف رابط استضافتك (أو `http://localhost:PORT`) في Redirect URLs — ده مطلوب عشان رابط "نسيت كلمة السر" يشتغل صح.
5. استبدل القيمتين الوهميتين في [`assets/lib/supabase-client.js`](assets/lib/supabase-client.js) بعنوان مشروعك ومفتاح **anon/public** فقط. لا تضع `service_role` في أي كود بيوصل للمتصفح.
6. شغّل المشروع بأي static server (`python3 -m http.server`) أو ارفعه لاستضافة static، وافتح `login.html` أو `register.html`.

## 2) بنية الكود

```
/assets
  /lib        اتصال Supabase، الحالة العامة للمصادقة، دوال التنسيق، الفلتر الزمني
  /types      توثيق شكل كل كيان (JSDoc typedefs فقط — مفيش TypeScript فعلي)
  /services   طبقة وصول البيانات: كيان واحد = ملف واحد، كل استعلام مقيّد بـ company_id
  /hooks      useAuth (تسجيل الدخول + الصلاحيات) وuseAsync (تحميل/فراغ/خطأ موحّد)
  /js         التحكم في كل صفحة (login.js, dashboard.js, orders.js...) + layout.js
  /css        التصميم (لم يتغيّر شكله أبدًا في هذه الجولة)
```

كل ملف بيعرّف global واحد بنمط IIFE (`const XService = (function(){...})()`) بدل ES Modules — القرار ده مقصود: صفحات المشروع لازم تفضل تشتغل حتى بفتحها مباشرة بـ `file://` (دبل كليك)، وES Modules بتتقفل بسياسة CORS على `file://` في أغلب المتصفحات.

## 3) المصادقة الحقيقية

- `services/auth-service.js` هو المكان الوحيد اللي بيكلم `supabaseClient.auth.*`. كل صفحة تانية بتكلمه هو بس.
- `hooks/use-auth.js` (`ensureAuthenticated`) بيحمّل المستخدم + البروفايل + الشركة، يخزّنهم في `lib/store.js` (`AuthStore`)، ويطبّق صلاحية الصفحة (`can_view_*`)، ويحوّل لو مفيش صلاحية أو مفيش تسجيل دخول.
- **التسجيل معاملاتي (atomic) بالكامل:** إنشاء الشركة + بروفايل المالك بيحصلوا مع بعض جوه دالة SQL واحدة (`register_company` في [`supabase/03-register-transaction.sql`](supabase/03-register-transaction.sql)) — لو أي خطوة فشلت، الاتنين بيترجعوا زي ما كانوا تلقائيًا (transaction rollback من Postgres نفسه)، من غير أي حاجة مكتوبة يدوي في الجافاسكريبت.
- بروفايل المالك بياخد `role = 'owner'` + كل صلاحيات `can_view_*` بالتلقائي.
- **لو مشروعك مفعّل عليه "Confirm email":** التسجيل بيحفظ بيانات الشركة مؤقتًا (`sessionStorage`) ويطلب من المستخدم يأكد إيميله الأول. أول ما يسجّل دخول (`login.js`)، الشركة والبروفايل بيتعملوا تلقائيًا في نفس اللحظة، وبعدين يتحوّل للداشبورد — من غير ما يحتاج يعمل أي خطوة إضافية.
- "نسيت كلمة السر" و"إعادة التعيين" بيستخدموا تدفق Supabase الحقيقي بالإيميل.
- رسائل الأخطاء (إيميل مسجّل بالفعل، بيانات دخول غلط، مشكلة شبكة، فشل إنشاء الشركة...) كلها بعربي واضح من `friendlyError()` جوه `auth-service.js`.

## 4) هوية الشركة في الواجهة

فوق يمين كل صفحة (بجانب زرار تسجيل الخروج) فيه شريط صغير بيعرض **اسم الشركة الحقيقي، اسم المالك/المستخدم، وشعار الشركة** (لو اترفع وقت التسجيل) — كله من `profile.company` و`profile.full_name` الحقيقيين، مفيش أي بيانات وهمية. لو مفيش شعار، بيظهر أول حرف من اسم الشركة كـ avatar بسيط.

## 5) عزل الشركات (Multi-tenant)

كل جدول بيانات عمل (`customers`, `conversations`, `messages`, `orders`, `notifications`, `products`, `campaigns`, `automation_recommendations`) فيه `company_id`، ومعزول بسياسة RLS بتسمح بس لصاحب نفس الشركة (أو مالك المنصة). فوق كده، كل دالة في `services/*.js` بتاخد `companyId` بشكل صريح وتفلتر بيه كمان (`*.eq("company_id", companyId)`) — يعني حماية مزدوجة، مش الاعتماد على RLS لوحدها.

## 6) الصلاحيات

كل مستخدم له أعمدة `can_view_*` مستقلة في `profiles` (محادثات، عملاء، طلبات، تقارير، أتمتة، إعدادات، إدارة فريق) — بتتحدد وقت التسجيل (المالك بياخد كل الصلاحيات) أو تدويًا من Supabase. الصفحات اللي المستخدم مالوش صلاحية عليها بتتشال من القائمة الجانبية تمامًا، ولو حاول يدخلها بالرابط مباشرة بيترجّع للداشبورد.

## 7) البيانات الحية والحالات (Loading / Empty / Error)

كل قسم بيانات في التطبيق بيمر بنفس الحالات التلاتة (`lib/format.js` + `hooks/use-async.js`):
1. **تحميل:** شرائط رمادية نابضة (`skeletonBlock`) لحد ما البيانات توصل.
2. **فارغ:** لو مفيش بيانات فعلاً (مش خطأ)، حالة واضحة بدون أي رقم وهمي.
3. **خطأ:** رسالة واضحة تفرّق بين "مشروع Supabase لسه مش متصل" و"مشكلة اتصال مؤقتة".

## 8) كروت الداشبورد الجديدة

- **Company Growth** — حقيقي 100%، بيتحسب من كل تاريخ الشركة على Supabase (مش الفلتر الزمني). نمو الإيراد/الطلبات/العملاء ومعدل التحويل بيتحسبوا فعليًا؛ **نمو الربح** بيعتمد على `orders.cost_total` (هيفضل صفر لحد ما تسجّل تكلفة حقيقية)، و**ROAS** بيفضل "غير متاح" بصراحة لحد ما تتصل بمنصة إعلانات حقيقية (الجدول `campaigns` جاهز ومستنيها).
- **Profit Trend** — حقيقي 100%، بيتبع الفلتر الزمني العام بالكامل، ونفس منطق التكلفة فوق.
- **Automation Recommendations** (`automation.html`) — بيقرأ من جدول `automation_recommendations` الحقيقي، ومقسّمة لـ 3 أقسام ثابتة حسب عمود `category`: **Ads** (توصيات الإعلانات)، **Growth** (توصيات نمو المشروع)، **Customers** (توصيات عملاء/شرائح محددة). **لما تربط أتمتة n8n (أو أي عملية server-side) تكتب في الجدول ده، لازم تحط `category` بالظبط واحدة من القيم التلاتة دي** — الجدول نفسه بيرفض أي قيمة تانية (انظر `supabase/05-recommendation-categories.sql`). الصفحة هتفضل فاضية (حالة فارغة صريحة لكل قسم لوحده) لحد ما توصلها بيانات حقيقية — مفيش أي كارت وهمي بديل.

## 9) الفلتر الزمني العام (Date Range)

فوق يمين كل صفحة محدد فترة زمنية عام (Today, Yesterday, Last 7/30/90 Days, This Month, Last Month, This Year، أو فترة مخصّصة)، محفوظ في `localStorage`، وبيتحكم في كل قسم مبني على بيانات فعلية. كل رقم "مقابل الفترة السابقة" حقيقي — ولو مفيش بيانات كفاية للمقارنة، بيظهر "لا تتوفر مقارنة بعد" صراحة. المنطق كله في `assets/lib/daterange.js`.

## 10) المنتجات (Settings > Products)

`services/products-service.js` بقى فيه كتابة كاملة (إضافة/تعديل/حذف)، وصفحة الإعدادات فيها تاب "Products" بيسمح لأي مستخدم عنده صلاحية `can_view_settings` (المالك بياخدها تلقائي) إنه يضيف منتج بالاسم، SKU، سعر البيع، والتكلفة. التكلفة دي بتتسجل في جدول `products` الحقيقي في Supabase، وهي الأساس اللي مبني عليه حساب الربح الحقيقي في باقي التطبيق (نفس فكرة `orders.cost_total`). `services/campaigns-service.js` لسه جاهز لتكامل إعلانات مستقبلي ومفيش صفحة بتعرضه لسه.

## 11) إدارة الفريق (Settings > Team)

المالك (أو أي عضو عنده `can_manage_team`) يقدر من تاب "Team" في الإعدادات إنه:
- **يضيف عضو جديد** بالاسم/الإيميل/كلمة السر ويحدد الصلاحيات (`can_view_*`) من نفس الفورم — ده بيستدعي Edge Function اسمها `create-team-member` (لازم تكون منشورة، راجع خطوة 2 فوق) لأن إنشاء تسجيل دخول جديد محتاج `service_role` key، ومينفعش الكود ده يشتغل في المتصفح أبدًا.
- **يعدّل صلاحيات عضو موجود** من نفس الجدول (checkboxes لكل صلاحية + زرار "حفظ" لكل صف) — ده استعلام عادي محمي بـ RLS (`supabase/07-fixes-team-products.sql`)، مفيش حاجة سيرفر لازمة له.
- صلاحيات المالك نفسه (`role = 'owner'`) مقفولة من الواجهة دي عمدًا — التعديل عليها بييتم من لوحة Supabase مباشرة لو احتجت.

## 12) باگات اتصلّحت (مهم تشغّل `07-fixes-team-products.sql`)

- **"إنشاء شركة جديدة مبيعملش حاجة"**: كان فيه mismatch حقيقي بين الكود وقاعدة البيانات — `register.js` و`register_company()` كانوا بيبعتوا/يحاولوا يكتبوا `logo`, `industry`, `country`, `timezone`, `currency`, `language` في جدول `companies`، لكن الجدول ده (في `setup.sql`) كان فيه بس `id`, `name`, `created_at`. كل محاولة تسجيل كانت بتفشل جوه الـ transaction بسبب "column does not exist"، فبترجع تتراجع كلها (rollback) من غير أي رسالة واضحة. `07-fixes-team-products.sql` بيضيف الأعمدة الناقصة دي.
- **خانة "تم التنفيذ" في صفحة الأتمتة كانت بتفشل بصمت**: الكود (`automation.js` + `recommendations-service.js`) بيقرا/يكتب عمود `completed`، لكن الجدول ماكانش فيه العمود ده أصلاً ولا سياسة تعديل. اتصلّحت في نفس الملف.
- **`orders.shipping_cost`**: `insights.js` بيجمعه في حساب التكلفة/الربح الحقيقي، بس العمود ماكانش موجود فعليًا (فكان دايمًا صفر). اتضاف كعمود حقيقي.

## 13) الجاهزية للتكامل مع n8n

`automation_recommendations` و`notifications` جداول **قراءة فقط من المتصفح** (فيما عدا خانة "تم التنفيذ" اللي الشركة نفسها تقدر تعدّلها) — مفيش أي سياسة INSERT عامة من `anon`/`authenticated` عمدًا. الكتابة الأساسية فيهم المفروض تتم من عملية موثوقة (workflow في n8n مثلاً) بمفتاح `service_role` (السري، مش اللي في الفرونت إند). لسه مفيش أي اتصال بـ Meta أو WhatsApp أو Facebook APIs في هذا الإصدار — دي خطوة تالية منفصلة.


## Production order contract
The `sync-workflow-messages-v2` Edge Function now accepts `order` or `order_data` from the n8n workflow. Recommended payload:
`{name, phone, address, city, notes, shipping_cost, discount, items:[{product_id, quantity, price}], source_message_id}`.
If `is_order:true` or `order_ready:true` is sent without structured order data, the function also attempts a deterministic fallback parser for labeled name/phone/address and a product name/SKU that exists in Settings > Products. Duplicate order creation is prevented when `source_message_id` is reused.

## WhatsApp + Instagram production setup

Both channels now use the same production Meta webhook endpoint as Facebook:
`https://bbixzcaxlvotdhhqfatw.supabase.co/functions/v1/facebook-webhook-v2`

Verify token: `botera_fb_webhook_2026`

### WhatsApp
Enter in Settings → WhatsApp Business:
- Meta App ID / Secret
- Phone Number ID
- WhatsApp Business Account ID (WABA)
- Cloud API access token
Then use **اختبار الاتصال والـWebhook**. The validator validates the phone and subscribes the Meta app to the WABA.

### Instagram
Enter in Settings → Instagram Professional:
- Meta App ID / Secret
- Instagram Professional Account ID
- Instagram access token
Then use **اختبار الاتصال والـWebhook**. The validator validates the account and subscribes the `messages` webhook field.

All three channels share the same conversation/message tables and the same outbound gateway. WhatsApp and Instagram replies are no longer local-only.


## n8n production sync endpoint
Use this URL in the existing n8n node named `Supabase - Sync Incoming Message`:
`https://bbixzcaxlvotdhhqfatw.supabase.co/functions/v1/sync-workflow-messages-v2`
Keep the existing headers `apikey`, `x-workflow-secret`, and `Content-Type: application/json`.
The sync function stores both customer and agent replies and creates orders from structured `order/order_data` or the supported multiline order message format.
