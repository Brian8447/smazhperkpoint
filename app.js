// SmazhPerkPoint staff desk. Public access is limited by Supabase RLS policies.
(function () {
  'use strict';

  var cfg = window.SMAZH_CONFIG || {};
  var configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey &&
    String(cfg.supabaseAnonKey).indexOf('PASTE_') !== 0);
  var sb = configured && window.supabase
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : null;
  function $(id) { return document.getElementById(id); }

  // Public staff login form on index.html.
  var loginForm = $('staff-login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var message = $('staff-login-msg');
      var button = loginForm.querySelector('button[type="submit"]');
      var email = $('staff-login-email').value.trim();
      var password = $('staff-login-password').value;
      if (!configured || !sb) {
        message.textContent = 'Staff sign-in is not configured yet. Please contact the site administrator.';
        return;
      }
      if (button) { button.disabled = true; button.dataset.label = button.textContent; button.textContent = 'Signing in…'; }
      message.textContent = '';
      try {
        var authResult = await sb.auth.signInWithPassword({ email: email, password: password });
        if (authResult.error) throw authResult.error;
        var staffResult = await sb.from('staff_users')
          .select('username,role,is_main_admin')
          .eq('id', authResult.data.user.id)
          .maybeSingle();
        if (staffResult.error || !staffResult.data) {
          await sb.auth.signOut();
          message.textContent = 'This account is not approved for staff access.';
          return;
        }
        window.location.assign('staff.html');
      } catch (error) {
        message.textContent = error && error.message ? error.message : 'Unable to sign in. Please try again.';
      } finally {
        if (button && document.visibilityState === 'visible' && !window.location.href.endsWith('staff.html')) {
          button.disabled = false;
          button.textContent = button.dataset.label || 'Staff login';
        }
      }
    });
  }

  var staffRoot = $('staff-root');
  if (!staffRoot) return;
  if (!configured || !sb) {
    $('loading').innerHTML = 'The staff desk is not connected yet. Please contact the site administrator.';
    return;
  }

  var customers = [];
  var rewards = [];
  var transactions = [];
  var selectedMemberId = null;
  var currentStaff = null;
  var currentUser = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function formatPoints(value) {
    return Math.round(Number(value) || 0).toLocaleString('en-MY');
  }

  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-MY', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur'
    }).format(date);
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (part) {
      return part.charAt(0).toUpperCase();
    }).join('') || '?';
  }

  function tierFor(lifetimePoints) {
    var points = Number(lifetimePoints) || 0;
    if (points >= 7000) return { name: 'Diamond', multiplier: 2 };
    if (points >= 3500) return { name: 'Platinum', multiplier: 1.75 };
    if (points >= 1500) return { name: 'Gold', multiplier: 1.5 };
    if (points >= 500) return { name: 'Silver', multiplier: 1.25 };
    return { name: 'Bronze', multiplier: 1 };
  }

  function currentMember() {
    return customers.find(function (member) { return member.id === selectedMemberId; }) || null;
  }

  function showNotice(message, type) {
    var notice = $('notice');
    if (!notice) return;
    notice.textContent = message || '';
    notice.className = 'notice ' + (type || 'success');
    notice.hidden = !message;
  }

  function openModal(id) {
    var modal = $(id);
    if (!modal) return;
    modal.hidden = false;
    var input = modal.querySelector('input:not([type="hidden"]), textarea, button');
    if (input) setTimeout(function () { input.focus(); }, 0);
  }

  function closeModal(id) {
    var modal = $(id);
    if (modal) modal.hidden = true;
  }

  function renderStats() {
    $('stat-members').textContent = formatPoints(customers.length);
    $('stat-points').textContent = formatPoints(customers.reduce(function (total, member) {
      return total + (Number(member.points) || 0);
    }, 0));
    $('stat-rewards').textContent = formatPoints(rewards.length);
    $('stat-transactions').textContent = formatPoints(transactions.length);
    $('member-count-label').textContent = formatPoints(customers.length) + ' total';
  }

  function renderRoster() {
    var term = $('member-search').value.trim().toLowerCase();
    var filtered = customers.filter(function (member) {
      return !term || [member.name, member.phone, member.email, member.member_code]
        .some(function (value) { return String(value || '').toLowerCase().includes(term); });
    });
    $('member-list').innerHTML = filtered.length ? filtered.map(function (member) {
      var selected = member.id === selectedMemberId;
      return '<button class="member-row' + (selected ? ' active' : '') + '" type="button" data-action="select-member" data-id="' + escapeHtml(member.id) + '" aria-pressed="' + selected + '">' +
        '<span class="avatar">' + escapeHtml(initials(member.name)) + '</span>' +
        '<span class="member-copy"><strong>' + escapeHtml(member.name) + '</strong><small>' + escapeHtml(member.member_code || 'Member') + (member.phone ? ' · ' + escapeHtml(member.phone) : '') + '</small></span>' +
        '<span class="member-points"><strong>' + formatPoints(member.points) + '</strong><small>points</small></span>' +
      '</button>';
    }).join('') : '<div class="empty-list">' + (term ? 'No member matches that search.' : 'No members yet. Add your first member to start.') + '</div>';
  }

  function transactionLabel(type) {
    if (type === 'earn') return 'Points earned';
    if (type === 'redeem') return 'Reward redeemed';
    if (type === 'opening') return 'Opening balance';
    return 'Balance adjustment';
  }

  function pointsDisplay(value) {
    var points = Number(value) || 0;
    var className = points < 0 ? 'points-negative' : 'points-positive';
    var prefix = points > 0 ? '+' : '';
    return '<span class="' + className + '">' + prefix + formatPoints(points) + ' pts</span>';
  }

  function renderMemberDetail() {
    var member = currentMember();
    if (!member) {
      $('member-detail').innerHTML = '<div class="empty-detail"><div><strong>Select a member</strong>Choose someone from the list or add a new member to begin.</div></div>';
      return;
    }
    var tier = tierFor(member.lifetime_points);
    var history = transactions.filter(function (entry) { return entry.customer_id === member.id; }).slice(0, 25);
    var joined = member.created_at ? formatDate(member.created_at) : '—';
    $('member-detail').innerHTML =
      '<div class="member-heading"><div class="member-title"><span class="avatar">' + escapeHtml(initials(member.name)) + '</span><div><p class="eyebrow">MEMBER PROFILE</p><h2>' + escapeHtml(member.name) + '</h2><div class="member-code">' + escapeHtml(member.member_code || 'No member code') + '</div><span class="tier-pill">✦ ' + tier.name + ' · ' + tier.multiplier + '× points</span></div></div>' +
      '<div class="member-actions"><button class="btn btn-primary btn-small" type="button" data-action="record-purchase">Record purchase</button><button class="btn btn-dark btn-small" type="button" data-action="redeem-points">Redeem points</button><button class="btn btn-light btn-small" type="button" data-action="edit-member">Edit details</button></div></div>' +
      '<div class="balance-grid"><div class="balance available"><div class="balance-label">Available points</div><div class="balance-value">' + formatPoints(member.points) + '</div></div><div class="balance"><div class="balance-label">Lifetime points earned</div><div class="balance-value">' + formatPoints(member.lifetime_points) + '</div></div></div>' +
      '<div class="details-grid"><div class="detail-item"><label>Phone</label><div>' + escapeHtml(member.phone || 'Not provided') + '</div></div><div class="detail-item"><label>Email</label><div>' + escapeHtml(member.email || 'Not provided') + '</div></div><div class="detail-item"><label>Address</label><div>' + escapeHtml(member.address || 'Not provided') + '</div></div><div class="detail-item"><label>Joined</label><div>' + escapeHtml(joined) + '</div></div><div class="detail-item wide"><label>Staff notes</label><div>' + escapeHtml(member.notes || 'No notes').replace(/\n/g, '<br>') + '</div></div></div>' +
      '<div class="member-history"><div class="section-head"><div><p class="eyebrow">MEMBER LEDGER</p><h2>Points history</h2></div></div>' +
      (history.length ? history.map(function (entry) {
        return '<div class="history-row"><div><strong>' + escapeHtml(transactionLabel(entry.type)) + '</strong><small>' + escapeHtml(entry.reason || 'No note') + ' · ' + escapeHtml(formatDate(entry.created_at)) + ' · ' + escapeHtml(entry.staff_name || 'Staff') + '</small></div><div>' + pointsDisplay(entry.points) + '</div></div>';
      }).join('') : '<div class="blank-note">No points activity recorded yet.</div>') + '</div>';
  }

  function renderRecentActivity() {
    var recent = transactions.slice(0, 30);
    $('recent-activity').innerHTML = recent.length ? recent.map(function (entry) {
      var member = customers.find(function (item) { return item.id === entry.customer_id; });
      return '<div class="activity-row"><div class="activity-member"><strong>' + escapeHtml(member ? member.name : 'Member') + ' · ' + escapeHtml(transactionLabel(entry.type)) + '</strong><small>' + escapeHtml(entry.reason || 'No note') + ' · ' + escapeHtml(entry.staff_name || 'Staff') + '</small></div><div>' + pointsDisplay(entry.points) + '</div><div class="activity-time"><small>' + escapeHtml(formatDate(entry.created_at)) + '</small></div></div>';
    }).join('') : '<div class="blank-note">New purchases and redemptions will appear here.</div>';
  }

  function renderRewards() {
    $('rewards-list').innerHTML = rewards.length ? rewards.map(function (reward) {
      return '<div class="reward-row"><div><strong>' + escapeHtml(reward.name) + '</strong><small>' + escapeHtml(reward.category || 'Reward') + (reward.description ? ' · ' + escapeHtml(reward.description) : '') + '</small></div><div class="reward-actions"><span class="reward-cost">' + formatPoints(reward.points_cost) + ' pts</span><button class="btn btn-danger btn-small" type="button" data-action="deactivate-reward" data-id="' + escapeHtml(reward.id) + '" aria-label="Remove ' + escapeHtml(reward.name) + '">Remove</button></div></div>';
    }).join('') : '<div class="blank-note">No active rewards yet. Add a reward to get started.</div>';
  }

  function renderDashboard() {
    renderStats();
    renderRoster();
    renderMemberDetail();
    renderRecentActivity();
    renderRewards();
  }

  async function refreshDashboard() {
    showNotice('', 'success');
    var results = await Promise.all([
      sb.from('customers').select('id,member_code,name,phone,email,address,notes,points,lifetime_points,created_at').order('created_at', { ascending: false }).limit(1000),
      sb.from('rewards').select('id,name,points_cost,category,description,active').eq('active', true).order('points_cost', { ascending: true }),
      sb.from('point_transactions').select('id,customer_id,type,points,reason,staff_name,created_at').order('created_at', { ascending: false }).limit(1000)
    ]);
    var failed = results.find(function (result) { return result.error; });
    if (failed) throw failed.error;
    customers = results[0].data || [];
    rewards = results[1].data || [];
    transactions = results[2].data || [];
    if (!customers.some(function (member) { return member.id === selectedMemberId; })) {
      selectedMemberId = customers.length ? customers[0].id : null;
    }
    renderDashboard();
  }

  async function verifyStaffSession() {
    var sessionResult = await sb.auth.getSession();
    if (sessionResult.error || !sessionResult.data.session) {
      window.location.replace('index.html#staff-login');
      return false;
    }
    currentUser = sessionResult.data.session.user;
    var staffResult = await sb.from('staff_users').select('username,role,is_main_admin').eq('id', currentUser.id).maybeSingle();
    if (staffResult.error || !staffResult.data) {
      await sb.auth.signOut();
      window.location.replace('index.html#staff-login');
      return false;
    }
    currentStaff = staffResult.data;
    $('staff-who').textContent = (currentStaff.username || currentUser.email || 'Staff') + (currentStaff.is_main_admin ? ' · Admin' : ' · ' + (currentStaff.role || 'Staff'));
    $('loading').hidden = true;
    $('dashboard').hidden = false;
    return true;
  }

  function openMemberForm(member) {
    var form = $('member-form');
    form.reset();
    form.elements.id.value = member ? member.id : '';
    $('member-modal-title').textContent = member ? 'Edit member details' : 'Add member';
    form.elements.name.value = member ? member.name || '' : '';
    form.elements.phone.value = member ? member.phone || '' : '';
    form.elements.email.value = member ? member.email || '' : '';
    form.elements.address.value = member ? member.address || '' : '';
    form.elements.member_code.value = member ? member.member_code || '' : '';
    form.elements.notes.value = member ? member.notes || '' : '';
    openModal('member-modal');
  }

  function makeMemberCode() {
    var bytes = new Uint8Array(4);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    var suffix = Array.prototype.map.call(bytes, function (byte) { return byte.toString(36).padStart(2, '0'); }).join('').toUpperCase().slice(0, 6);
    return 'SP-' + suffix;
  }

  async function insertMember(payload, requestedCode) {
    for (var attempt = 0; attempt < 5; attempt += 1) {
      var memberCode = requestedCode || makeMemberCode();
      var result = await sb.from('customers').insert(Object.assign({}, payload, { member_code: memberCode })).select().single();
      if (!result.error) return result.data;
      if (requestedCode || result.error.code !== '23505') throw result.error;
    }
    throw new Error('Could not generate a unique membership code. Please try again.');
  }

  $('member-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var values = new FormData(form);
    var memberId = String(values.get('id') || '');
    var requestedCode = String(values.get('member_code') || '').trim().toUpperCase();
    var payload = {
      name: String(values.get('name') || '').trim(),
      phone: String(values.get('phone') || '').trim() || null,
      email: String(values.get('email') || '').trim() || null,
      address: String(values.get('address') || '').trim() || null,
      notes: String(values.get('notes') || '').trim() || null
    };
    try {
      if (memberId) {
        var existingMember = customers.find(function (member) { return member.id === memberId; });
        payload.member_code = requestedCode || (existingMember && existingMember.member_code);
        var updateResult = await sb.from('customers').update(payload).eq('id', memberId).select().single();
        if (updateResult.error) throw updateResult.error;
        selectedMemberId = memberId;
        showNotice('Member details saved.', 'success');
      } else {
        var createdMember = await insertMember(payload, requestedCode);
        selectedMemberId = createdMember.id;
        showNotice('Member added with code ' + createdMember.member_code + '.', 'success');
      }
      closeModal('member-modal');
      await refreshDashboard();
    } catch (error) {
      showNotice(error && error.code === '23505' ? 'That member code is already in use. Choose another.' : (error.message || 'Could not save the member.'), 'error');
    }
  });

  function updatePurchasePreview() {
    var member = currentMember();
    var amount = Number($('purchase-amount').value) || 0;
    if (!member || amount <= 0) {
      $('purchase-preview').innerHTML = 'Points earned: <strong>0</strong>';
      return;
    }
    var tier = tierFor(member.lifetime_points);
    var points = Math.round(amount * tier.multiplier);
    $('purchase-preview').innerHTML = 'Points earned: <strong>' + formatPoints(points) + '</strong> · ' + tier.name + ' ' + tier.multiplier + '× rate';
  }

  function openPurchaseForm() {
    var member = currentMember();
    if (!member) return;
    $('purchase-form').reset();
    var tier = tierFor(member.lifetime_points);
    $('purchase-member-label').textContent = member.name + ' earns points at the ' + tier.name + ' ' + tier.multiplier + '× rate.';
    updatePurchasePreview();
    openModal('purchase-modal');
  }

  $('purchase-amount').addEventListener('input', updatePurchasePreview);
  $('purchase-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var member = currentMember();
    var amount = Number($('purchase-amount').value);
    if (!member || !Number.isFinite(amount) || amount <= 0) return;
    var tier = tierFor(member.lifetime_points);
    var points = Math.round(amount * tier.multiplier);
    if (points <= 0) { showNotice('Enter an amount that earns at least one point.', 'error'); return; }
    var note = $('purchase-note').value.trim();
    var reason = 'Purchase amount ' + amount.toFixed(2) + ' · ' + tier.name + ' ' + tier.multiplier + '×' + (note ? ' · ' + note : '');
    try {
      var result = await sb.from('point_transactions').insert({ customer_id: member.id, type: 'earn', points: points, reason: reason, staff_name: currentStaff.username || currentUser.email });
      if (result.error) throw result.error;
      closeModal('purchase-modal');
      showNotice(formatPoints(points) + ' points added to ' + member.name + '.', 'success');
      await refreshDashboard();
    } catch (error) {
      showNotice(error.message || 'Could not record the purchase.', 'error');
    }
  });

  function openRedeemForm() {
    var member = currentMember();
    if (!member) return;
    $('redeem-form').reset();
    $('redeem-member-label').textContent = 'Redeem points for ' + member.name + '.';
    $('redeem-balance').innerHTML = 'Available balance: <strong>' + formatPoints(member.points) + ' points</strong>';
    $('redeem-points').max = String(Number(member.points) || 0);
    openModal('redeem-modal');
  }

  $('redeem-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var member = currentMember();
    var points = Math.floor(Number($('redeem-points').value));
    var reason = $('redeem-reason').value.trim();
    if (!member || !Number.isFinite(points) || points <= 0 || !reason) return;
    if (points > Number(member.points)) { showNotice('That is more than the member’s available balance.', 'error'); return; }
    try {
      var result = await sb.from('point_transactions').insert({ customer_id: member.id, type: 'redeem', points: -points, reason: reason, staff_name: currentStaff.username || currentUser.email });
      if (result.error) throw result.error;
      closeModal('redeem-modal');
      showNotice(formatPoints(points) + ' points redeemed for ' + member.name + '.', 'success');
      await refreshDashboard();
    } catch (error) {
      showNotice(error.message || 'Could not record the redemption.', 'error');
    }
  });

  $('reward-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var values = new FormData(event.currentTarget);
    var payload = {
      name: String(values.get('name') || '').trim(),
      points_cost: Math.floor(Number(values.get('points_cost'))),
      category: String(values.get('category') || '').trim() || null,
      description: String(values.get('description') || '').trim() || null,
      icon: '🎁',
      active: true
    };
    try {
      var result = await sb.from('rewards').insert(payload);
      if (result.error) throw result.error;
      event.currentTarget.reset();
      event.currentTarget.hidden = true;
      $('toggle-reward-form').textContent = '＋ Add reward';
      showNotice('Reward added to the catalog.', 'success');
      await refreshDashboard();
    } catch (error) {
      showNotice(error.message || 'Could not add the reward.', 'error');
    }
  });

  $('member-search').addEventListener('input', renderRoster);
  $('add-member-btn').addEventListener('click', function () { openMemberForm(null); });
  $('toggle-reward-form').addEventListener('click', function () {
    var form = $('reward-form');
    form.hidden = !form.hidden;
    this.textContent = form.hidden ? '＋ Add reward' : 'Cancel';
    if (!form.hidden) $('reward-name').focus();
  });
  $('cancel-reward').addEventListener('click', function () {
    $('reward-form').reset();
    $('reward-form').hidden = true;
    $('toggle-reward-form').textContent = '＋ Add reward';
  });
  $('sign-out').addEventListener('click', async function () {
    await sb.auth.signOut();
    window.location.assign('index.html');
  });

  document.addEventListener('click', async function (event) {
    var closeButton = event.target.closest('[data-close-modal]');
    if (closeButton) { closeModal(closeButton.getAttribute('data-close-modal')); return; }
    var actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    var action = actionButton.getAttribute('data-action');
    if (action === 'select-member') {
      selectedMemberId = actionButton.getAttribute('data-id');
      renderRoster();
      renderMemberDetail();
      return;
    }
    if (action === 'edit-member') { openMemberForm(currentMember()); return; }
    if (action === 'record-purchase') { openPurchaseForm(); return; }
    if (action === 'redeem-points') { openRedeemForm(); return; }
    if (action === 'deactivate-reward') {
      var rewardId = actionButton.getAttribute('data-id');
      var reward = rewards.find(function (item) { return item.id === rewardId; });
      if (!reward || !window.confirm('Remove “' + reward.name + '” from the active rewards catalog?')) return;
      try {
        var result = await sb.from('rewards').update({ active: false }).eq('id', rewardId);
        if (result.error) throw result.error;
        showNotice('Reward removed from the active catalog.', 'success');
        await refreshDashboard();
      } catch (error) {
        showNotice(error.message || 'Could not remove the reward.', 'error');
      }
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') ['member-modal', 'purchase-modal', 'redeem-modal'].forEach(closeModal);
  });

  verifyStaffSession().then(function (isStaff) {
    if (!isStaff) return;
    refreshDashboard().catch(function (error) {
      showNotice(error.message || 'Could not load membership data. Check the database connection.', 'error');
    });
  }).catch(function () {
    window.location.replace('index.html#staff-login');
  });
})();
