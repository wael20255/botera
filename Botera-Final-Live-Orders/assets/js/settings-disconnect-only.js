// Integrations: the only UI addition is a Disconnect button.
(function () {
  let booting = false;
  let profile = null;
  let rowsByChannel = new Map();

  function toast(message, isError = false) {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = `position:fixed;bottom:24px;left:24px;z-index:10050;padding:12px 16px;border-radius:12px;background:${isError ? '#3a1111' : '#102f1a'};color:#fff;border:1px solid ${isError ? '#7f1d1d' : '#1f7a3d'};box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:14px;direction:rtl;`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  async function loadRows() {
    if (!profile?.company_id) return;
    const { data, error } = await supabaseClient
      .from('integration_accounts')
      .select('id,channel,is_active,connection_status,metadata')
      .eq('company_id', profile.company_id);
    if (error) throw error;
    rowsByChannel = new Map((data || []).map((row) => [row.channel, row]));
  }

  function channelForCard(card) {
    if (card.id === 'googleSheetsOrdersCard') return 'sheets_orders';
    return card.dataset.integrationCard || null;
  }

  function getActionHost(card) {
    return card.querySelector('[data-integration-form] > div:last-child')
      || card.querySelector('[data-google-form] > button:last-of-type')?.parentElement
      || card.querySelector('#googleSheetsOrdersForm');
  }

  async function disconnect(row, button) {
    if (!row?.id) return;
    const ok = window.confirm('هل تريد فصل هذا الربط؟ سيتم إيقافه داخل Botera ويمكنك ربط حساب جديد بعد ذلك.');
    if (!ok) return;
    button.disabled = true;
    try {
      const metadata = {
        ...(row.metadata || {}),
        connection_status: 'disconnected',
        disconnected_at: new Date().toISOString(),
      };
      const { error } = await supabaseClient
        .from('integration_accounts')
        .update({
          is_active: false,
          connection_status: 'disconnected',
          metadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (error) throw error;
      toast('تم فصل الربط ✓');
      window.dispatchEvent(new CustomEvent('boterarealtimechange'));
      setTimeout(() => window.location.reload(), 350);
    } catch (error) {
      button.disabled = false;
      toast(error?.message || 'تعذر فصل الربط.', true);
    }
  }

  function addDisconnectButton(card, row) {
    if (!row?.is_active) return;
    if (card.querySelector('[data-disconnect-only]')) return;

    const host = getActionHost(card);
    if (!host) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-secondary';
    button.dataset.disconnectOnly = row.id;
    button.dataset.disconnectOnly = '1';
    button.textContent = 'فصل الربط';
    button.style.borderColor = '#7f1d1d';
    button.style.color = '#fecaca';
    button.style.marginInlineStart = '8px';
    button.addEventListener('click', () => disconnect(row, button));

    host.appendChild(button);
  }

  async function enhance() {
    if (!profile || booting) return;
    booting = true;
    try {
      await loadRows();
      document.querySelectorAll('[data-integration-card], #googleSheetsOrdersCard').forEach((card) => {
        const channel = channelForCard(card);
        if (!channel) return;
        addDisconnectButton(card, rowsByChannel.get(channel));
      });
    } catch (error) {
      console.warn('Disconnect control unavailable:', error);
    } finally {
      booting = false;
    }
  }

  async function boot() {
    try {
      if (typeof useAuth === 'undefined') return;
      profile = await useAuth.ensureAuthenticated({ requiredPermission: 'can_view_settings' });
      if (!profile) return;
      const observer = new MutationObserver(() => enhance());
      observer.observe(document.body, { childList: true, subtree: true });
      await enhance();
    } catch (error) {
      console.warn('Disconnect-only integration script failed:', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
