// SmazhPerkPoint staff app — Supabase client + Cashier Desk / Portal /
// Rewards / Insights. No keys in this file: config comes from
// public/config.js (copy of config.example.js, filled in by the user).
// Uses the Supabase JS client from CDN. If config.js is missing or the
// key is still the placeholder, the app shows a setup message instead
// of failing silently.
(function () {
  'use strict';
  var cfg = window.SMAZH_CONFIG || {};
  var configured = cfg.supabaseUrl && cfg.supabaseAnonKey &&
    cfg.supabaseAnonKey.indexOf('PASTE_') !== 0;
  var sb = null;
  if (configured && window.supabase) {
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  }
  function $(id) { return document.getElementById(id); }
  function show(el, html) { if (el) el.innerHTML = html; }
  function tierFor(lp) {
    if (lp >= 7000) return ['Diamond', 2];
    if (lp >= 3500) return ['Platinum', 1.75];
    if (lp >= 1500) return ['Gold', 1.5];
    if (lp >= 500) return ['Silver', 1.25];
    return ['Bronze', 1];
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function setupMsg() {
    return '<p><strong>Setup needed:</strong> copy <code>config.example.js</code> to ' +
      '<code>config.js</code> and paste your Supabase publishable (anon) key. ' +
      'See README.md step 4. No customer data is shown until then.</p>';
  }

  // ---- public-page login form (index.html) ----
  var loginForm = $('staff-login-form');
  if (loginForm) {
    // Already signed in? Skip the login page and go straight to the staff desk.
    if (sb) sb.auth.getSession().then(function (res) {
      if (res.data.session) window.location.replace('staff.html');
    });
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var msg = $('staff-login-msg');
      var email = $('staff-login-email').value.trim();
      var pw = $('staff-login-password').value;
      if (!configured) { msg.textContent = 'Supabase is not set up yet — see README.md step 4 (config.js). The real staff sign-in is in Muse until then.'; return; }
      msg.textContent = 'Signing in…';
      var res = await sb.auth.signInWithPassword({ email: email, password: pw });
      if (res.error) { msg.textContent = 'Sign-in failed: ' + res.error.message; return; }
      window.location.href = 'staff.html';
    });
  }

  // ---- staff.html ----
  var staffRoot = $('staff-root');
  if (!staffRoot) return;
  if (!configured) { show(staffRoot, setupMsg()); return; }

  var currentUser = null, currentStaff = null;
  async function loadSession() {
    var res = await sb.auth.getSession();
    currentUser = res.data.session ? res.data.session.user : null;
    if (!currentUser) { window.location.href = 'login.html'; return false; }
    var s = await sb.from('staff_users').select('*').eq('id', currentUser.id).single();
    currentStaff = s.data || { username: currentUser.email, role: 'staff', is_main_admin: false };
    $('staff-who').textContent = 'Signed in as ' + currentStaff.username +
      (currentStaff.is_main_admin ? ' · Main admin · Protected' : ' · ' + currentStaff.role);
    return true;
  }
  async function loadOverview() {
    var c = await sb.from('customers').select('*').order('created_at', { ascending: false }).limit(100);
    var t = await sb.from('point_transactions').select('*').order('created_at', { ascending: false }).limit(20);
    var r = await sb.from('rewards').select('*').eq('active', true).order('points_cost');
    var customers = c.data || [], txns = t.data || [], rewards = r.data || [];
    var totalPoints = customers.reduce(function (a, x) { return a + (x.points || 0); }, 0);
    var totalLifetime = customers.reduce(function (a, x) { return a + (x.lifetime_points || 0); }, 0);
    show($('overview'), '<p><strong>' + customers.length + '</strong> members · ' +
      '<strong>' + totalPoints + '</strong> spendable points · ' +
      '<strong>' + totalLifetime + '</strong> lifetime points · ' +
      '<strong>' + rewards.length + '</strong> rewards</p>');
    show($('roster'), customers.map(function (m) {
      var tier = tierFor(m.lifetime_points || 0);
      return '<div class="card"><strong>' + esc(m.name) + '</strong> · ' + esc(m.member_code) +
        '<br>Tier: ' + tier[0] + ' (' + tier[1] + '×) · Points: ' + (m.points || 0) +
        ' · Lifetime: ' + (m.lifetime_points || 0) +
        '<br><button data-view="' + m.id + '">View</button> ' +
        '<button data-add="' + m.id + '">Add Pts</button></div>';
    }).join('') || '<p>No members yet — import the Muse export (README step 5).</p>');
    show($('activity'), txns.map(function (x) {
      return '<div>' + esc(x.type) + ' ' + x.points + ' pts · staff: ' + esc(x.staff_name) +
        ' · ' + esc(x.reason || '') + ' · ' + new Date(x.created_at).toLocaleString() + '</div>';
    }).join('') || '<p>No points activity yet.</p>');
    show($('rewards'), rewards.map(function (x) {
      return '<div class="card"><strong>' + esc(x.name) + '</strong> — ' + x.points_cost +
        ' pts · ' + esc(x.category || '') + '<br>' + esc(x.description || '') +
        ' <button data-del-reward="' + x.id + '">Remove</button></div>';
    }).join(''));
    show($('insights'), customers.slice().sort(function (a, b) {
      return (b.lifetime_points || 0) - (a.lifetime_points || 0);
    }).slice(0, 5).map(function (m, i) {
      return '<div>' + (i + 1) + '. ' + esc(m.name) + ' — ' + (m.lifetime_points || 0) + ' lifetime pts</div>';
    }).join('') || '<p>No members yet.</p>');
    staffRoot.addEventListener('click', async function (e) {
      var addId = e.target.getAttribute('data-add');
      var viewId = e.target.getAttribute('data-view');
      var delId = e.target.getAttribute('data-del-reward');
      if (addId) {
        var pts = parseInt(prompt('How many points to add?', '100'), 10);
        if (!pts) return;
        var reason = prompt('Reason (e.g. Spend $100)', 'Spend') || '';
        var ins = await sb.from('point_transactions').insert({
          customer_id: addId, type: 'earn', points: pts,
          reason: reason, staff_name: currentStaff.username
        });
        if (ins.error) alert('Could not add points: ' + ins.error.message);
        else loadOverview();
      }
      if (viewId) {
        var d = await sb.from('point_transactions').select('*').eq('customer_id', viewId).order('created_at', { ascending: false });
        alert((d.data || []).map(function (x) {
          return x.type + ' ' + x.points + ' · ' + x.staff_name + ' · ' + (x.reason || '');
        }).join('\n') || 'No history yet.');
      }
      if (delId) {
        if (!confirm('Remove this reward?')) return;
        await sb.from('rewards').delete().eq('id', delId);
        loadOverview();
      }
    }, { once: true });
  }
  var addReward = $('add-reward-form');
  if (addReward) addReward.addEventListener('submit', async function (e) {
    e.preventDefault();
    var ins = await sb.from('rewards').insert({
      name: $('reward-name').value.trim(),
      points_cost: parseInt($('reward-cost').value, 10),
      category: $('reward-category').value.trim(),
      description: $('reward-desc').value.trim(),
      icon: '🎁'
    });
    if (ins.error) alert('Could not add reward: ' + ins.error.message);
    else { addReward.reset(); loadOverview(); }
  });
  var signOut = $('sign-out');
  if (signOut) signOut.addEventListener('click', async function () {
    await sb.auth.signOut();
    window.location.href = 'index.html';
  });
  loadSession().then(function (ok) { if (ok) loadOverview(); });
})();
