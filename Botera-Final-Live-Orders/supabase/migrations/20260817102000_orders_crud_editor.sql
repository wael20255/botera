-- Orders CRUD editor support: writable order_items + transactional save + safe order totals.

DO $$
BEGIN
  DROP POLICY IF EXISTS "order_items_insert_own_company" ON public.order_items;
  DROP POLICY IF EXISTS "order_items_update_own_company" ON public.order_items;
  DROP POLICY IF EXISTS "order_items_delete_own_company" ON public.order_items;

  CREATE POLICY "order_items_insert_own_company"
    ON public.order_items
    FOR INSERT
    TO authenticated
    WITH CHECK (company_id = current_company_id());

  CREATE POLICY "order_items_update_own_company"
    ON public.order_items
    FOR UPDATE
    TO authenticated
    USING (company_id = current_company_id())
    WITH CHECK (company_id = current_company_id());

  CREATE POLICY "order_items_delete_own_company"
    ON public.order_items
    FOR DELETE
    TO authenticated
    USING (company_id = current_company_id());
END $$;

CREATE OR REPLACE FUNCTION public.fill_order_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_price numeric;
  v_cost numeric;
  v_subtotal numeric;
  v_cost_total numeric;
  v_charge_to_customer boolean := false;
BEGIN
  -- Existing multi-item orders must be driven by their actual Order Items,
  -- not by a single legacy orders.product_id value.
  IF EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = NEW.id) THEN
    SELECT
      COALESCE(SUM(oi.total), 0),
      COALESCE(SUM(oi.cost * oi.quantity), 0)
    INTO v_subtotal, v_cost_total
    FROM public.order_items oi
    WHERE oi.order_id = NEW.id;

    SELECT COALESCE(ss.charge_to_customer, false)
      INTO v_charge_to_customer
    FROM public.shipping_settings ss
    WHERE ss.company_id = NEW.company_id
    LIMIT 1;

    NEW.subtotal := v_subtotal;
    NEW.cost_total := v_cost_total;
    NEW.total := GREATEST(
      0,
      v_subtotal
      + CASE WHEN v_charge_to_customer THEN COALESCE(NEW.shipping_cost, 0) ELSE 0 END
      - COALESCE(NEW.discount, 0)
    );
    RETURN NEW;
  END IF;

  -- Preserve the legacy single-product behavior for orders that do not have
  -- Order Items yet.
  SELECT price, cost
    INTO v_price, v_cost
  FROM public.products
  WHERE id = NEW.product_id
    AND company_id = NEW.company_id;

  IF FOUND THEN
    NEW.total := COALESCE(v_price, NEW.total, 0);
    NEW.subtotal := COALESCE(v_price, NEW.subtotal, 0);
    NEW.cost_total := COALESCE(v_cost, NEW.cost_total, 0);
  END IF;

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.save_order_with_items(uuid, uuid, uuid, jsonb, jsonb, jsonb);

CREATE FUNCTION public.save_order_with_items(
  p_company_id uuid,
  p_order_id uuid,
  p_customer_id uuid,
  p_customer jsonb,
  p_order jsonb,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid := p_order_id;
  v_customer_id uuid := p_customer_id;
  v_existing_customer uuid;
  v_company_id uuid := current_company_id();
  v_order_number text;
  v_created_at timestamptz;
  v_product_id uuid;
  v_quantity integer;
  v_first_product_id uuid;
  v_shipping_cost numeric := COALESCE((p_order ->> 'shipping_cost')::numeric, 0);
  v_discount numeric := COALESCE((p_order ->> 'discount')::numeric, 0);
  v_return_shipping_cost numeric := COALESCE((p_order ->> 'return_shipping_cost')::numeric, 0);
  v_charge_to_customer boolean := false;
BEGIN
  IF p_company_id IS NULL OR p_company_id <> v_company_id THEN
    RAISE EXCEPTION 'Company scope mismatch';
  END IF;

  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'At least one order item is required';
  END IF;

  IF NULLIF(trim(COALESCE(p_customer ->> 'name', '')), '') IS NULL THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;

  -- Reuse an existing customer by explicit ID, or by exact company + phone.
  IF v_customer_id IS NOT NULL THEN
    PERFORM 1 FROM public.customers WHERE id = v_customer_id AND company_id = v_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer not found';
    END IF;
  ELSE
    IF NULLIF(trim(COALESCE(p_customer ->> 'phone', '')), '') IS NOT NULL THEN
      SELECT c.id INTO v_existing_customer
      FROM public.customers c
      WHERE c.company_id = v_company_id
        AND c.phone = trim(p_customer ->> 'phone')
      ORDER BY c.created_at ASC
      LIMIT 1;
    END IF;
    v_customer_id := v_existing_customer;
  END IF;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (
      company_id, name, phone, email, country, city, address, notes,
      status, updated_at
    )
    VALUES (
      v_company_id,
      trim(p_customer ->> 'name'),
      NULLIF(trim(COALESCE(p_customer ->> 'phone', '')), ''),
      NULLIF(trim(COALESCE(p_customer ->> 'email', '')), ''),
      NULLIF(trim(COALESCE(p_customer ->> 'country', '')), ''),
      NULLIF(trim(COALESCE(p_customer ->> 'city', '')), ''),
      NULLIF(trim(COALESCE(p_customer ->> 'address', '')), ''),
      NULLIF(trim(COALESCE(p_customer ->> 'notes', '')), ''),
      'lead',
      now()
    )
    RETURNING id INTO v_customer_id;
  ELSE
    UPDATE public.customers
    SET
      name = trim(p_customer ->> 'name'),
      phone = NULLIF(trim(COALESCE(p_customer ->> 'phone', '')), ''),
      email = NULLIF(trim(COALESCE(p_customer ->> 'email', '')), ''),
      country = NULLIF(trim(COALESCE(p_customer ->> 'country', '')), ''),
      city = NULLIF(trim(COALESCE(p_customer ->> 'city', '')), ''),
      address = NULLIF(trim(COALESCE(p_customer ->> 'address', '')), ''),
      notes = NULLIF(trim(COALESCE(p_customer ->> 'notes', '')), ''),
      updated_at = now()
    WHERE id = v_customer_id
      AND company_id = v_company_id;
  END IF;

  SELECT COALESCE(ss.charge_to_customer, false)
    INTO v_charge_to_customer
  FROM public.shipping_settings ss
  WHERE ss.company_id = v_company_id
  LIMIT 1;

  v_order_number := NULLIF(trim(COALESCE(p_order ->> 'order_number', '')), '');
  IF v_order_number IS NULL THEN
    v_order_number := 'ORD-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  END IF;

  v_created_at := COALESCE(NULLIF(p_order ->> 'created_at', '')::timestamptz, now());

  IF v_order_id IS NULL THEN
    INSERT INTO public.orders (
      company_id, customer_id, conversation_id, order_number,
      status, payment_status, shipping_status, shipping_cost, discount,
      currency, notes, created_by, created_at, updated_at,
      return_shipping_cost, customer_order_name, customer_account_name,
      source_page_name, source_page_id, source_message_id
    )
    VALUES (
      v_company_id,
      v_customer_id,
      NULLIF(p_order ->> 'conversation_id', '')::uuid,
      v_order_number,
      COALESCE(NULLIF(p_order ->> 'status', ''), 'pending'),
      COALESCE(NULLIF(p_order ->> 'payment_status', ''), 'pending'),
      COALESCE(NULLIF(p_order ->> 'shipping_status', ''), 'pending'),
      v_shipping_cost,
      v_discount,
      COALESCE(NULLIF(p_order ->> 'currency', ''), 'EGP'),
      NULLIF(trim(COALESCE(p_order ->> 'notes', '')), ''),
      auth.uid(),
      v_created_at,
      now(),
      v_return_shipping_cost,
      NULLIF(trim(COALESCE(p_order ->> 'customer_order_name', '')), ''),
      NULLIF(trim(COALESCE(p_order ->> 'customer_account_name', '')), ''),
      NULLIF(trim(COALESCE(p_order ->> 'source_page_name', '')), ''),
      NULLIF(trim(COALESCE(p_order ->> 'source_page_id', '')), ''),
      NULLIF(trim(COALESCE(p_order ->> 'source_message_id', '')), '')
    )
    RETURNING id INTO v_order_id;
  ELSE
    PERFORM 1 FROM public.orders WHERE id = v_order_id AND company_id = v_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order not found';
    END IF;

    UPDATE public.orders
    SET
      customer_id = v_customer_id,
      conversation_id = NULLIF(p_order ->> 'conversation_id', '')::uuid,
      order_number = v_order_number,
      status = COALESCE(NULLIF(p_order ->> 'status', ''), status),
      payment_status = COALESCE(NULLIF(p_order ->> 'payment_status', ''), payment_status),
      shipping_status = COALESCE(NULLIF(p_order ->> 'shipping_status', ''), shipping_status),
      shipping_cost = v_shipping_cost,
      discount = v_discount,
      currency = COALESCE(NULLIF(p_order ->> 'currency', ''), currency),
      notes = NULLIF(trim(COALESCE(p_order ->> 'notes', '')), ''),
      created_at = v_created_at,
      updated_at = now(),
      return_shipping_cost = v_return_shipping_cost,
      customer_order_name = NULLIF(trim(COALESCE(p_order ->> 'customer_order_name', '')), ''),
      customer_account_name = NULLIF(trim(COALESCE(p_order ->> 'customer_account_name', '')), ''),
      source_page_name = NULLIF(trim(COALESCE(p_order ->> 'source_page_name', '')), ''),
      source_page_id = NULLIF(trim(COALESCE(p_order ->> 'source_page_id', '')), ''),
      source_message_id = NULLIF(trim(COALESCE(p_order ->> 'source_message_id', '')), '')
    WHERE id = v_order_id
      AND company_id = v_company_id;
  END IF;

  -- Replace line items as one atomic editor operation.
  DELETE FROM public.order_items
  WHERE order_id = v_order_id
    AND company_id = v_company_id;

  FOR v_product_id, v_quantity IN
    SELECT
      (item ->> 'product_id')::uuid,
      GREATEST(1, COALESCE((item ->> 'quantity')::integer, 1))
    FROM jsonb_array_elements(p_items) AS item
  LOOP
    IF v_first_product_id IS NULL THEN
      v_first_product_id := v_product_id;
    END IF;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Every order item must have a product';
    END IF;

    INSERT INTO public.order_items (company_id, order_id, product_id, quantity)
    VALUES (v_company_id, v_order_id, v_product_id, v_quantity);
  END LOOP;

  -- Keep legacy single-product compatibility while making multi-item orders
  -- authoritative from their Order Items.
  UPDATE public.orders
  SET
    product_id = CASE WHEN (SELECT count(*) FROM public.order_items WHERE order_id = v_order_id) = 1 THEN v_first_product_id ELSE NULL END,
    shipping_cost = v_shipping_cost,
    discount = v_discount,
    return_shipping_cost = v_return_shipping_cost,
    total = GREATEST(
      0,
      COALESCE((SELECT SUM(total) FROM public.order_items WHERE order_id = v_order_id), 0)
      + CASE WHEN v_charge_to_customer THEN v_shipping_cost ELSE 0 END
      - v_discount
    ),
    subtotal = COALESCE((SELECT SUM(total) FROM public.order_items WHERE order_id = v_order_id), 0),
    cost_total = COALESCE((SELECT SUM(cost * quantity) FROM public.order_items WHERE order_id = v_order_id), 0),
    updated_at = now()
  WHERE id = v_order_id
    AND company_id = v_company_id;

  -- Keep the customer summary fields synchronized with the actual orders.
  UPDATE public.customers c
  SET
    total_orders = COALESCE((
      SELECT count(*)
      FROM public.orders o
      WHERE o.customer_id = c.id
        AND o.company_id = v_company_id
        AND o.status <> 'cancelled'
    ), 0),
    total_spent = COALESCE((
      SELECT sum(o.total)
      FROM public.orders o
      WHERE o.customer_id = c.id
        AND o.company_id = v_company_id
        AND o.status = 'delivered'
    ), 0),
    last_order_at = (
      SELECT max(o.created_at)
      FROM public.orders o
      WHERE o.customer_id = c.id
        AND o.company_id = v_company_id
        AND o.status <> 'cancelled'
    ),
    updated_at = now()
  WHERE c.id = v_customer_id
    AND c.company_id = v_company_id;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_order_with_items(uuid, uuid, uuid, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_order_with_items(uuid, uuid, uuid, jsonb, jsonb, jsonb) TO authenticated;
