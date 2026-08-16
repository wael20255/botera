-- Botera production operations: orders from chat, product content, shipping and daily ad expenses.
alter table public.products add column if not exists description text;
alter table public.orders add column if not exists source_message_id text;
create unique index if not exists orders_source_message_id_uq on public.orders(source_message_id) where source_message_id is not null;

create table if not exists public.shipping_settings (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 provider text, default_cost numeric not null default 0, active boolean not null default true,
 metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists shipping_settings_company_uq on public.shipping_settings(company_id);

create table if not exists public.shipping_expenses (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 expense_date date not null, provider text, amount numeric not null default 0, notes text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists shipping_expenses_company_date_idx on public.shipping_expenses(company_id, expense_date);

create table if not exists public.ad_expenses (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 expense_date date not null, platform text, campaign_id uuid references public.campaigns(id) on delete set null,
 amount numeric not null default 0, entry_mode text not null default 'manual', notes text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists ad_expenses_company_date_idx on public.ad_expenses(company_id, expense_date);

create or replace function public.save_order_from_chat(p_company_id uuid,p_conversation_id uuid,p_customer_id uuid,p_order jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_order_id uuid; v_order_number text; v_source_message_id text; v_subtotal numeric:=0; v_shipping numeric:=0; v_discount numeric:=0; v_total numeric:=0; v_cost numeric:=0; v_item jsonb; v_product record; v_qty integer; v_price numeric; v_cost_unit numeric;
begin
 if p_company_id is null or p_conversation_id is null or p_customer_id is null then raise exception 'company, conversation and customer are required'; end if;
 if not exists(select 1 from customers where id=p_customer_id and company_id=p_company_id) then raise exception 'customer_not_found'; end if;
 v_source_message_id:=nullif(trim(coalesce(p_order->>'source_message_id','')),'');
 if v_source_message_id is not null then select id into v_order_id from orders where source_message_id=v_source_message_id limit 1; if v_order_id is not null then return jsonb_build_object('ok',true,'order_id',v_order_id,'duplicate',true); end if; end if;
 update customers set name=coalesce(nullif(trim(p_order->>'name'),''),name),phone=coalesce(nullif(trim(p_order->>'phone'),''),phone),address=coalesce(nullif(trim(p_order->>'address'),''),address),city=coalesce(nullif(trim(p_order->>'city'),''),city),notes=coalesce(nullif(trim(p_order->>'notes'),''),notes),status='customer',last_order_at=now(),updated_at=now() where id=p_customer_id and company_id=p_company_id;
 select default_cost into v_shipping from shipping_settings where company_id=p_company_id and active=true limit 1; v_shipping:=coalesce((p_order->>'shipping_cost')::numeric,v_shipping,0); v_discount:=coalesce((p_order->>'discount')::numeric,0);
 v_order_number:=nullif(trim(p_order->>'order_number'),''); if v_order_number is null then v_order_number:='BOT-'||to_char(now(),'YYMMDDHH24MISS')||'-'||substr(replace(p_customer_id::text,'-',''),1,6); end if;
 insert into orders(company_id,customer_id,conversation_id,order_number,status,payment_status,shipping_status,subtotal,shipping_cost,discount,total,currency,cost_total,notes,source_message_id,created_at,updated_at) values(p_company_id,p_customer_id,p_conversation_id,v_order_number,'pending','pending','pending',0,v_shipping,v_discount,0,'EGP',0,p_order->>'notes',v_source_message_id,now(),now()) returning id into v_order_id;
 if jsonb_typeof(p_order->'items')='array' then
  for v_item in select value from jsonb_array_elements(p_order->'items') loop
   v_qty:=greatest(1,coalesce((v_item->>'quantity')::integer,1));
   select id,name,sku,price,cost into v_product from products where company_id=p_company_id and ((nullif(trim(v_item->>'product_id'),'') is not null and id=(v_item->>'product_id')::uuid) or (nullif(trim(v_item->>'sku'),'') is not null and sku=v_item->>'sku') or (nullif(trim(v_item->>'product_name'),'') is not null and lower(name)=lower(v_item->>'product_name')) ) limit 1;
   if not found then raise exception 'product_not_found: %',coalesce(v_item->>'product_name',v_item->>'sku'); end if;
   v_price:=coalesce((v_item->>'price')::numeric,v_product.price,0); v_cost_unit:=coalesce(v_product.cost,0);
   insert into order_items(company_id,order_id,product_id,quantity,price,cost,total,product_name,sku) values(p_company_id,v_order_id,v_product.id,v_qty,v_price,v_cost_unit,v_price*v_qty,v_product.name,v_product.sku);
   v_subtotal:=v_subtotal+v_price*v_qty; v_cost:=v_cost+v_cost_unit*v_qty;
  end loop;
 elsif p_order->>'product_id' is not null then
  select id,name,sku,price,cost into v_product from products where company_id=p_company_id and id=(p_order->>'product_id')::uuid limit 1; if not found then raise exception 'product_not_found'; end if;
  v_qty:=greatest(1,coalesce((p_order->>'quantity')::integer,1)); v_price:=coalesce((p_order->>'price')::numeric,v_product.price,0); v_cost_unit:=coalesce(v_product.cost,0);
  insert into order_items(company_id,order_id,product_id,quantity,price,cost,total,product_name,sku) values(p_company_id,v_order_id,v_product.id,v_qty,v_price,v_cost_unit,v_price*v_qty,v_product.name,v_product.sku); v_subtotal:=v_price*v_qty; v_cost:=v_cost_unit*v_qty;
 end if;
 if v_subtotal=0 then raise exception 'order_items_required'; end if;
 v_total:=greatest(0,v_subtotal+v_shipping-v_discount);
 update orders set subtotal=v_subtotal,total=v_total,cost_total=v_cost,product_id=(select product_id from order_items where order_id=v_order_id order by created_at limit 1),updated_at=now() where id=v_order_id;
 update customers set total_orders=coalesce(total_orders,0)+1,total_spent=coalesce(total_spent,0)+v_total,last_order_at=now(),updated_at=now() where id=p_customer_id;
 return jsonb_build_object('ok',true,'order_id',v_order_id,'order_number',v_order_number,'subtotal',v_subtotal,'shipping_cost',v_shipping,'discount',v_discount,'total',v_total);
exception when others then if v_order_id is not null then delete from orders where id=v_order_id; end if; raise;
end; $$;
grant execute on function public.save_order_from_chat(uuid,uuid,uuid,jsonb) to service_role;

alter table public.shipping_settings enable row level security;
alter table public.shipping_expenses enable row level security;
alter table public.ad_expenses enable row level security;
create policy shipping_settings_select on public.shipping_settings for select using (company_id=current_company_id() or is_platform_owner());
create policy shipping_settings_write on public.shipping_settings for all using (company_id=current_company_id() and exists(select 1 from profiles p where p.id=auth.uid() and (p.can_view_settings or p.is_platform_owner))) with check (company_id=current_company_id() and exists(select 1 from profiles p where p.id=auth.uid() and (p.can_view_settings or p.is_platform_owner)));
create policy shipping_expenses_select on public.shipping_expenses for select using (company_id=current_company_id() or is_platform_owner());
create policy shipping_expenses_write on public.shipping_expenses for all using (company_id=current_company_id() and exists(select 1 from profiles p where p.id=auth.uid() and (p.can_view_settings or p.is_platform_owner))) with check (company_id=current_company_id() and exists(select 1 from profiles p where p.id=auth.uid() and (p.can_view_settings or p.is_platform_owner)));
create policy ad_expenses_select on public.ad_expenses for select using (company_id=current_company_id() or is_platform_owner());
create policy ad_expenses_write on public.ad_expenses for all using (company_id=current_company_id() and exists(select 1 from profiles p where p.id=auth.uid() and (p.can_view_settings or p.is_platform_owner))) with check (company_id=current_company_id() and exists(select 1 from profiles p where p.id=auth.uid() and (p.can_view_settings or p.is_platform_owner)));
