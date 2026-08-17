alter table public.orders add column if not exists customer_order_name text;
alter table public.orders add column if not exists customer_account_name text;
alter table public.orders add column if not exists source_page_name text;
alter table public.orders add column if not exists source_page_id text;

update public.orders o
set customer_account_name = coalesce(o.customer_account_name, c.name)
from public.customers c
where c.id=o.customer_id and o.customer_account_name is null;

update public.orders o
set source_page_name = coalesce(o.source_page_name, ia.external_account_name),
    source_page_id = coalesce(o.source_page_id, ia.external_account_id)
from public.conversations cv
join public.integration_accounts ia
  on ia.company_id=cv.company_id
 and ia.channel=cv.channel
 and ia.external_account_id=cv.platform_id
 and ia.is_active=true
where o.conversation_id=cv.id
  and o.source_page_name is null;

create index if not exists orders_source_page_idx on public.orders(company_id,source_page_name);

create or replace function public.save_order_from_chat(p_company_id uuid,p_conversation_id uuid,p_customer_id uuid,p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_order_id uuid;
  v_order_number text;
  v_source_message_id text;
  v_subtotal numeric:=0;
  v_shipping numeric:=0;
  v_discount numeric:=0;
  v_total numeric:=0;
  v_cost numeric:=0;
  v_item jsonb;
  v_product record;
  v_qty integer;
  v_price numeric;
  v_cost_unit numeric;
  v_account_name text;
  v_page_name text;
  v_page_id text;
begin
  if p_company_id is null or p_conversation_id is null or p_customer_id is null then
    raise exception 'company, conversation and customer are required';
  end if;
  if not exists(select 1 from customers where id=p_customer_id and company_id=p_company_id) then
    raise exception 'customer_not_found';
  end if;

  v_source_message_id:=nullif(trim(coalesce(p_order->>'source_message_id','')),'');
  if v_source_message_id is not null then
    select id into v_order_id from orders where source_message_id=v_source_message_id limit 1;
    if v_order_id is not null then
      return jsonb_build_object('ok',true,'order_id',v_order_id,'duplicate',true);
    end if;
  end if;

  select c.name into v_account_name
  from customers c
  where c.id=p_customer_id and c.company_id=p_company_id;

  select ia.external_account_name,ia.external_account_id
  into v_page_name,v_page_id
  from conversations cv
  left join integration_accounts ia
    on ia.company_id=cv.company_id
   and ia.channel=cv.channel
   and ia.external_account_id=cv.platform_id
   and ia.is_active=true
  where cv.id=p_conversation_id
    and cv.company_id=p_company_id
  order by ia.updated_at desc nulls last
  limit 1;

  update customers
  set phone=coalesce(nullif(trim(p_order->>'phone'),''),phone),
      address=coalesce(nullif(trim(p_order->>'address'),''),address),
      city=coalesce(nullif(trim(p_order->>'city'),''),city),
      country=coalesce(nullif(trim(p_order->>'country'),''),country),
      notes=coalesce(nullif(trim(p_order->>'notes'),''),notes),
      status='customer',
      last_order_at=now(),
      updated_at=now()
  where id=p_customer_id and company_id=p_company_id;

  select default_cost into v_shipping
  from shipping_settings
  where company_id=p_company_id and active=true
  limit 1;
  v_shipping:=coalesce((p_order->>'shipping_cost')::numeric,v_shipping,0);
  v_discount:=coalesce((p_order->>'discount')::numeric,0);

  v_order_number:=nullif(trim(p_order->>'order_number'),'');
  if v_order_number is null then
    v_order_number:='BOT-'||to_char(now(),'YYMMDDHH24MISS')||'-'||substr(replace(p_customer_id::text,'-',''),1,6);
  end if;

  insert into orders(
    company_id,customer_id,conversation_id,order_number,status,payment_status,shipping_status,
    subtotal,shipping_cost,discount,total,currency,cost_total,notes,source_message_id,
    customer_order_name,customer_account_name,source_page_name,source_page_id,created_at,updated_at
  ) values(
    p_company_id,p_customer_id,p_conversation_id,v_order_number,'pending','pending','pending',
    0,v_shipping,v_discount,0,'EGP',0,p_order->>'notes',v_source_message_id,
    nullif(trim(p_order->>'name'),''),v_account_name,v_page_name,v_page_id,now(),now()
  ) returning id into v_order_id;

  if jsonb_typeof(p_order->'items')='array' then
    for v_item in select value from jsonb_array_elements(p_order->'items') loop
      v_qty:=greatest(1,coalesce((v_item->>'quantity')::integer,1));
      select id,name,sku,price,cost into v_product
      from products
      where company_id=p_company_id
        and (
          (nullif(trim(v_item->>'product_id'),'') is not null and id=(v_item->>'product_id')::uuid)
          or (nullif(trim(v_item->>'sku'),'') is not null and sku=v_item->>'sku')
          or (nullif(trim(v_item->>'product_name'),'') is not null and lower(name)=lower(v_item->>'product_name'))
        )
      limit 1;
      if not found then raise exception 'product_not_found: %',coalesce(v_item->>'product_name',v_item->>'sku'); end if;
      v_price:=coalesce((v_item->>'price')::numeric,v_product.price,0);
      v_cost_unit:=coalesce(v_product.cost,0);
      insert into order_items(company_id,order_id,product_id,quantity,price,cost,total,product_name,sku)
      values(p_company_id,v_order_id,v_product.id,v_qty,v_price,v_cost_unit,v_price*v_qty,v_product.name,v_product.sku);
      v_subtotal:=v_subtotal+v_price*v_qty;
      v_cost:=v_cost+v_cost_unit*v_qty;
    end loop;
  elsif p_order->>'product_id' is not null then
    select id,name,sku,price,cost into v_product
    from products where company_id=p_company_id and id=(p_order->>'product_id')::uuid limit 1;
    if not found then raise exception 'product_not_found'; end if;
    v_qty:=greatest(1,coalesce((p_order->>'quantity')::integer,1));
    v_price:=coalesce((p_order->>'price')::numeric,v_product.price,0);
    v_cost_unit:=coalesce(v_product.cost,0);
    insert into order_items(company_id,order_id,product_id,quantity,price,cost,total,product_name,sku)
    values(p_company_id,v_order_id,v_product.id,v_qty,v_price,v_cost_unit,v_price*v_qty,v_product.name,v_product.sku);
    v_subtotal:=v_price*v_qty;
    v_cost:=v_cost_unit*v_qty;
  end if;

  if v_subtotal=0 then raise exception 'order_items_required'; end if;
  v_total:=greatest(0,v_subtotal+v_shipping-v_discount);

  update orders
  set subtotal=v_subtotal,
      total=v_total,
      cost_total=v_cost,
      product_id=(select product_id from order_items where order_id=v_order_id order by created_at limit 1),
      updated_at=now()
  where id=v_order_id;

  update customers
  set total_orders=coalesce(total_orders,0)+1,
      total_spent=coalesce(total_spent,0)+v_total,
      last_order_at=now(),
      updated_at=now()
  where id=p_customer_id;

  return jsonb_build_object(
    'ok',true,
    'order_id',v_order_id,
    'order_number',v_order_number,
    'customer_order_name',p_order->>'name',
    'customer_account_name',v_account_name,
    'source_page_name',v_page_name,
    'subtotal',v_subtotal,
    'shipping_cost',v_shipping,
    'discount',v_discount,
    'total',v_total
  );
exception when others then
  if v_order_id is not null then delete from orders where id=v_order_id; end if;
  raise;
end;
$$;

grant execute on function public.save_order_from_chat(uuid,uuid,uuid,jsonb) to service_role;

create or replace function public.auto_mark_order_delivered_from_message()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_company_id uuid;
  v_order_id uuid;
  v_text text;
begin
  if coalesce(new.sender,'') <> 'customer' then return new; end if;
  v_text:=lower(replace(replace(replace(coalesce(new.message,''),'أ','ا'),'إ','ا'),'آ','ا'));
  select company_id into v_company_id from conversations where id=new.conversation_id;
  if v_company_id is null then return new; end if;
  if v_text ~ '(استلمت|استلمنا|تم الاستلام|الاوردر وصل|الاوردر وصلني|الطلب وصل|الطلب وصلني|وصلني الاوردر|وصلني الأوردر|وصل الطلب|وصل الاوردر|وصل الأوردر|الاوردر جه|الطلب جه)' then
    select id into v_order_id
    from orders
    where company_id=v_company_id
      and conversation_id=new.conversation_id
      and status not in ('cancelled','refunded')
    order by created_at desc
    limit 1;
    if v_order_id is not null then
      update orders
      set status='delivered',shipping_status='delivered',updated_at=now()
      where id=v_order_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_mark_order_delivered on public.messages;
create trigger trg_auto_mark_order_delivered
after insert on public.messages
for each row execute function public.auto_mark_order_delivered_from_message();