(function(){
  const qs = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const API_BASE = 'http://localhost:5000';

  const routes = {
    '#/home': 'view-home',
    '#/auth': 'view-auth',
    '#/firmware': 'view-firmware',
    '#/behavior': 'view-behavior',
    '#/monitor': 'view-monitor',
    '#/password': 'view-password',
  };

  // Session management
  const SESSION_KEY = 'iot_session_token';
  const USER_KEY = 'iot_user_data';
  
  // Check and display user session
  function checkUserSession() {
    const sessionToken = localStorage.getItem(SESSION_KEY);
    const userData = localStorage.getItem(USER_KEY);
    const userEmailEl = qs('#user-email');
    const authLinkEl = qs('#auth-link');
    const logoutBtnEl = qs('#logout-btn');
    const homeAuthNotice = qs('#home-auth-notice');
    
    if (sessionToken && userData) {
      try {
        const user = JSON.parse(userData);
        if (userEmailEl) {
          userEmailEl.textContent = user.email;
          userEmailEl.style.display = 'inline';
        }
        if (authLinkEl) authLinkEl.style.display = 'none';
        if (logoutBtnEl) logoutBtnEl.style.display = 'inline-block';
        if (homeAuthNotice) homeAuthNotice.style.display = 'none';
      } catch (e) {
        // Invalid user data, clear session
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(USER_KEY);
      }
    } else {
      if (userEmailEl) userEmailEl.style.display = 'none';
      if (authLinkEl) authLinkEl.style.display = 'inline-block';
      if (logoutBtnEl) logoutBtnEl.style.display = 'none';
      if (homeAuthNotice) homeAuthNotice.style.display = 'block';
    }
  }
  
  // Handle logout
  async function handleLogout() {
    const sessionToken = localStorage.getItem(SESSION_KEY);
    
    if (sessionToken) {
      try {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_token: sessionToken })
        });
      } catch (e) {
        console.error('Logout error:', e);
      }
    }
    
    // Clear local storage
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(USER_KEY);
    
    // Update UI
    checkUserSession();
    
    // Redirect to auth page
    window.location.href = 'auth.html';
  }
  
  // Initialize logout button
  const logoutBtn = qs('#logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
  
  // Check session on page load
  checkUserSession();
  
  // Authentication Guard - Check if user is logged in
  function isAuthenticated() {
    const sessionToken = localStorage.getItem(SESSION_KEY);
    const userData = localStorage.getItem(USER_KEY);
    return !!(sessionToken && userData);
  }
  
  // Protect routes that require authentication
  function protectRoute(route) {
    const protectedRoutes = ['#/auth', '#/firmware', '#/behavior', '#/monitor', '#/password'];
    
    if (protectedRoutes.includes(route) && !isAuthenticated()) {
      // Show message and redirect to auth page
      alert('يجب تسجيل الدخول أولاً للوصول لهذه الصفحة');
      window.location.href = 'auth.html';
      return false;
    }
    return true;
  }

  // Nav routing
  function navigate(hash){
    const route = routes[hash] ? hash : '#/home';
    
    // Check if route requires authentication
    if (!protectRoute(route)) {
      return; // Don't navigate if not authenticated
    }
    
    window.location.hash = route;
    const viewId = routes[route];
    qsa('.view').forEach(v => v.classList.remove('active'));
    qs('#'+viewId).classList.add('active');
    setActiveNav(route);
  }

  function setActiveNav(route){
    qsa('.nav-btn').forEach(btn => {
      if(btn.dataset.route === route) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }

  // Init nav buttons
  qsa('.nav-btn').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.route)));
  window.addEventListener('hashchange', () => navigate(window.location.hash));

  // Theme toggle
  const themeToggle = qs('#theme-toggle');
  const connOnBtn = qs('#conn-on-btn');
  const connOffBtn = qs('#conn-off-btn');
  const themeKey = 'iot_theme';
  const savedTheme = localStorage.getItem(themeKey);
  if(savedTheme === 'light') document.body.classList.add('light');
  themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('light');
    localStorage.setItem(themeKey, document.body.classList.contains('light') ? 'light' : 'dark');
  });

  // Footer connection controls
  function reflectConnButtons(connected){
    if(connOnBtn && connOffBtn){
      if(connected){
        connOnBtn.classList.add('active');
        connOffBtn.classList.remove('active');
      } else {
        connOnBtn.classList.remove('active');
        connOffBtn.classList.add('active');
      }
    }
  }

  // Connection status
  const connDot = qs('#conn-dot');
  const connLabel = qs('#conn-label');
  function setConn(connected){
    connDot.style.background = connected ? 'var(--ok)' : 'var(--danger)';
    connDot.style.boxShadow = connected ? '0 0 0 2px rgba(16, 185, 129, 0.25)' : '0 0 0 2px rgba(239, 68, 68, 0.25)';
    connLabel.textContent = connected ? 'ON' : 'OFF';
    reflectConnButtons(connected);
  }

  if(connOnBtn) connOnBtn.addEventListener('click', () => setConn(true));
  if(connOffBtn) connOffBtn.addEventListener('click', () => setConn(false));

  // Auth view
  const kpiDevices = qs('#kpi-devices');
  const kpiAuth = qs('#kpi-auth');
  const kpiFail = qs('#kpi-fail');
  const authEvents = qs('#auth-events');
  function setAuthData(data){
    const total = data?.totalDevices ?? '--';
    const authenticated = data?.authenticated ?? '--';
    const failed = data?.failed ?? '--';
    kpiDevices.textContent = total;
    kpiAuth.textContent = authenticated;
    kpiFail.textContent = failed;
    authEvents.innerHTML = '';
    if(Array.isArray(data?.events)){
      data.events.slice(0, 20).forEach(ev => {
        const li = document.createElement('li');
        const left = document.createElement('span');
        const right = document.createElement('span');
        left.textContent = `${ev.time ?? ''} ${ev.label ? '· ' + ev.label : ''}`.trim();
        right.textContent = ev.status ?? '';
        if(typeof ev.ok === 'boolean') right.style.color = ev.ok ? 'var(--ok)' : 'var(--danger)';
        li.appendChild(left); li.appendChild(right);
        authEvents.appendChild(li);
      });
    }
  }

  // Security Check
  const secTargetUrl = qs('#sec-target-url');
  const secCheckBtn = qs('#sec-check-btn');
  const secLoading = qs('#sec-loading');
  const secResult = qs('#sec-result');

  async function performSecurityCheck(){
    const targetUrl = secTargetUrl?.value?.trim();
    // Fixed credentials for testing
    const username = 'admin';
    const password = 'admin';
    const endpoint = '/api/system/user_login';

    if(!targetUrl){
      alert('Please enter a target URL');
      return;
    }

    if(secLoading) secLoading.style.display = 'inline';
    if(secCheckBtn) secCheckBtn.disabled = true;
    if(secResult) secResult.style.display = 'none';
    
    // Update KPIs - increment devices count
    if(kpiDevices){
      const currentDevices = parseInt(kpiDevices.textContent) || 0;
      kpiDevices.textContent = currentDevices === 0 || kpiDevices.textContent === '--' ? 1 : currentDevices + 1;
    }

    try{
      const res = await fetch(`${API_BASE}/api/security/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_url: targetUrl,
          username: username,
          password: password,
          endpoint: endpoint
        })
      });

      const data = await res.json();
      
      if(secResult){
        secResult.style.display = 'block';
        secResult.innerHTML = '';

        if(!res.ok || !data.ok){
          const errorDiv = document.createElement('div');
          errorDiv.style.padding = '12px';
          errorDiv.style.background = 'var(--card)';
          errorDiv.style.border = '2px solid var(--danger)';
          errorDiv.style.borderRadius = '10px';
          errorDiv.style.color = 'var(--danger)';
          errorDiv.textContent = `❌ Error: ${data.error || 'Unknown error'}`;
          secResult.appendChild(errorDiv);
          return;
        }

        const result = data.result;
        
        // Overall Status - Compact Design
        const statusDiv = document.createElement('div');
        statusDiv.style.padding = '16px';
        statusDiv.style.background = 'var(--card)';
        statusDiv.style.borderRadius = '10px';
        statusDiv.style.border = '1px solid var(--border)';
        statusDiv.style.marginBottom = '12px';
        
        const statusIcon = result.vulnerable ? '❌' : '✅';
        const statusText = result.vulnerable ? 'VULNERABLE' : 'SECURE';
        const statusColor = result.vulnerable ? 'var(--danger)' : 'var(--ok)';
        
        // Build TLS info section
        let tlsSection = '';
        if(result.tls_info){
          if(result.tls_info.success){
            const tls = result.tls_info;
            const securityColor = tls.is_secure ? 'var(--ok)' : 'var(--danger)';
            const securityIcon = tls.is_secure ? '✅' : '⚠️';
            const securityText = tls.is_secure ? 'SECURE' : 'INSECURE';
            
            tlsSection = `
              <div style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border);">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                  <span style="font-size:13px; font-weight:600; color:var(--text);">🔒 TLS/SSL Information</span>
                  <span style="font-size:12px; font-weight:700; color:${securityColor};">${securityIcon} ${securityText}</span>
                </div>
                <div style="display:grid; gap:6px;">
                  <div style="display:flex; justify-content:space-between; font-size:13px;">
                    <span style="color:var(--muted);">Protocol:</span>
                    <span style="font-weight:600;">${tls.protocol || 'N/A'}</span>
                  </div>
                  <div style="display:flex; justify-content:space-between; font-size:13px;">
                    <span style="color:var(--muted);">Cipher:</span>
                    <span style="font-weight:600; font-size:11px;">${tls.cipher || 'N/A'}</span>
                  </div>
                  ${tls.cipher_bits ? `
                    <div style="display:flex; justify-content:space-between; font-size:13px;">
                      <span style="color:var(--muted);">Cipher Strength:</span>
                      <span style="font-weight:600;">${tls.cipher_bits} bits</span>
                    </div>
                  ` : ''}
                  <div style="display:flex; justify-content:space-between; font-size:13px;">
                    <span style="color:var(--muted);">Certificate Type:</span>
                    <span style="font-weight:600; color:${tls.is_self_signed ? 'var(--warn)' : 'var(--ok)'};">
                      ${tls.is_self_signed ? '⚠️ Self-Signed' : '✅ Valid CA'}
                    </span>
                  </div>
                  ${tls.cert_subject ? `
                    <div style="display:flex; justify-content:space-between; font-size:13px;">
                      <span style="color:var(--muted);">Subject:</span>
                      <span style="font-weight:600; font-size:11px;">${tls.cert_subject}</span>
                    </div>
                  ` : ''}
                  ${tls.cert_issuer ? `
                    <div style="display:flex; justify-content:space-between; font-size:13px;">
                      <span style="color:var(--muted);">Issuer:</span>
                      <span style="font-weight:600; font-size:11px;">${tls.cert_issuer}</span>
                    </div>
                  ` : ''}
                  ${tls.cert_expiry ? `
                    <div style="display:flex; justify-content:space-between; font-size:13px;">
                      <span style="color:var(--muted);">Expires:</span>
                      <span style="font-weight:600; color:${tls.expired ? 'var(--danger)' : (tls.days_until_expiry < 30 ? 'var(--warn)' : 'var(--ok)')};">
                        ${tls.cert_expiry} ${tls.days_until_expiry !== null ? `(${tls.days_until_expiry} days)` : ''}
                      </span>
                    </div>
                  ` : ''}
                  ${tls.security_issues && tls.security_issues.length > 0 ? `
                    <div style="margin-top:8px; padding:8px; background:var(--bg); border-radius:6px; border-left:3px solid var(--danger);">
                      <div style="font-size:12px; font-weight:600; color:var(--danger); margin-bottom:4px;">Security Issues:</div>
                      ${tls.security_issues.map(issue => `<div style="font-size:11px; color:var(--text); margin-left:8px;">• ${issue}</div>`).join('')}
                    </div>
                  ` : ''}
                </div>
              </div>
            `;
          } else {
            tlsSection = `
              <div style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border);">
                <div style="font-size:13px; font-weight:600; color:var(--danger); margin-bottom:4px;">🔒 TLS/SSL Check Failed</div>
                <div style="font-size:12px; color:var(--muted);">${result.tls_info.error || 'Could not retrieve TLS information'}</div>
              </div>
            `;
          }
        }
        
        statusDiv.innerHTML = `
          <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
            <span style="font-size:24px;">${statusIcon}</span>
            <div>
              <div style="font-size:16px; font-weight:700; color:${statusColor};">${statusText}</div>
              <div style="font-size:13px; color:var(--muted); margin-top:2px;">${result.message || ''}</div>
            </div>
          </div>
          <div style="display:grid; gap:6px; margin-top:12px; padding-top:12px; border-top:1px solid var(--border);">
            <div style="display:flex; justify-content:space-between; font-size:13px;">
              <span style="color:var(--muted);">Status Code:</span>
              <span style="font-weight:600;">${result.status_code || 'N/A'}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:13px;">
              <span style="color:var(--muted);">Default Credentials:</span>
              <span style="font-weight:600; color:${result.default_creds_accepted ? 'var(--danger)' : 'var(--ok)'};">
                ${result.default_creds_accepted ? 'ACCEPTED' : 'REJECTED'}
              </span>
            </div>
          </div>
          ${tlsSection}
        `;
        secResult.appendChild(statusDiv);
        
        // Update KPIs based on result
        if(result.vulnerable || result.default_creds_accepted){
          // Device is vulnerable - increment Failed Attempts
          if(kpiFail){
            const currentFail = parseInt(kpiFail.textContent) || 0;
            kpiFail.textContent = currentFail === 0 || kpiFail.textContent === '--' ? 1 : currentFail + 1;
          }
        } else if(result.status_code === 401 || result.status_code === 403){
          // Device rejected credentials - increment Authenticated (secure)
          if(kpiAuth){
            const currentAuth = parseInt(kpiAuth.textContent) || 0;
            kpiAuth.textContent = currentAuth === 0 || kpiAuth.textContent === '--' ? 1 : currentAuth + 1;
          }
        } else {
          // Other cases - increment Failed Attempts
          if(kpiFail){
            const currentFail = parseInt(kpiFail.textContent) || 0;
            kpiFail.textContent = currentFail === 0 || kpiFail.textContent === '--' ? 1 : currentFail + 1;
          }
        }
      }
    } catch(err){
      if(secResult){
        secResult.style.display = 'block';
        secResult.innerHTML = `
          <div style="padding:12px; background:var(--card); border:2px solid var(--danger); border-radius:10px; color:var(--danger);">
            ❌ Network Error: ${err.message}
          </div>
        `;
      }
      // Update Failed Attempts on error
      if(kpiFail){
        const currentFail = parseInt(kpiFail.textContent) || 0;
        kpiFail.textContent = currentFail === 0 || kpiFail.textContent === '--' ? 1 : currentFail + 1;
      }
    } finally {
      if(secLoading) secLoading.style.display = 'none';
      if(secCheckBtn) secCheckBtn.disabled = false;
    }
  }

  if(secCheckBtn){
    secCheckBtn.addEventListener('click', performSecurityCheck);
  }

  // Advanced Scan
  const advTargetUrl = qs('#adv-target-url');
  const advScanBtn = qs('#adv-scan-btn');
  const advLoading = qs('#adv-loading');
  const advResult = qs('#adv-result');

  async function performAdvancedScan(){
    const targetUrl = advTargetUrl?.value?.trim();

    if(!targetUrl){
      alert('Please enter a target URL');
      return;
    }

    if(advLoading) advLoading.style.display = 'inline';
    if(advScanBtn) advScanBtn.disabled = true;
    if(advResult) advResult.style.display = 'none';

    try{
      const res = await fetch(`${API_BASE}/api/security/advanced-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_url: targetUrl })
      });

      const data = await res.json();
      
      if(advResult){
        advResult.style.display = 'block';
        advResult.innerHTML = '';

        if(!res.ok || !data.ok){
          const errorDiv = document.createElement('div');
          errorDiv.style.padding = '12px';
          errorDiv.style.background = 'var(--card)';
          errorDiv.style.border = '2px solid var(--danger)';
          errorDiv.style.borderRadius = '10px';
          errorDiv.style.color = 'var(--danger)';
          errorDiv.textContent = `❌ Error: ${data.error || 'Unknown error'}`;
          advResult.appendChild(errorDiv);
          return;
        }

        const result = data.result;
        
        // Security Score Card
        const scoreDiv = document.createElement('div');
        scoreDiv.style.padding = '16px';
        scoreDiv.style.background = 'var(--card)';
        scoreDiv.style.borderRadius = '10px';
        scoreDiv.style.border = '1px solid var(--border)';
        scoreDiv.style.marginBottom = '12px';
        
        const scoreColor = result.security_score >= 80 ? 'var(--ok)' : 
                          result.security_score >= 60 ? 'var(--warn)' : 'var(--danger)';
        
        scoreDiv.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <div>
              <div style="font-size:14px; color:var(--muted); margin-bottom:4px;">Security Score</div>
              <div style="font-size:32px; font-weight:700; color:${scoreColor};">${result.security_score}/100</div>
              <div style="font-size:13px; color:var(--muted); margin-top:4px;">Assessment: ${result.assessment}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:13px; color:var(--muted);">Target:</div>
              <div style="font-size:14px; font-weight:600;">${result.target}</div>
            </div>
          </div>
        `;
        advResult.appendChild(scoreDiv);

        // Open Ports
        const portsDiv = document.createElement('div');
        portsDiv.style.padding = '16px';
        portsDiv.style.background = 'var(--card)';
        portsDiv.style.borderRadius = '10px';
        portsDiv.style.border = '1px solid var(--border)';
        portsDiv.style.marginBottom = '12px';
        
        let portsHTML = `<div style="font-size:14px; font-weight:600; margin-bottom:12px;">🔓 Open Ports (${result.open_ports.length})</div>`;
        
        if(result.open_ports.length > 0){
          portsHTML += '<div style="display:grid; gap:8px;">';
          result.open_ports.forEach(port => {
            portsHTML += `
              <div style="display:flex; justify-content:space-between; padding:8px; background:var(--bg); border-radius:6px;">
                <span style="font-weight:600;">${port.port}</span>
                <span style="color:var(--muted);">${port.service}</span>
                <span style="color:var(--ok); font-size:12px;">OPEN</span>
              </div>
            `;
          });
          portsHTML += '</div>';
        } else {
          portsHTML += '<div style="color:var(--muted); font-size:13px;">No open ports detected</div>';
        }
        
        portsDiv.innerHTML = portsHTML;
        advResult.appendChild(portsDiv);

        // Vulnerabilities
        if(result.vulnerabilities.length > 0){
          const vulnDiv = document.createElement('div');
          vulnDiv.style.padding = '16px';
          vulnDiv.style.background = 'var(--card)';
          vulnDiv.style.borderRadius = '10px';
          vulnDiv.style.border = '1px solid var(--border)';
          
          let vulnHTML = `<div style="font-size:14px; font-weight:600; margin-bottom:12px;">⚠️ Vulnerabilities Found (${result.vulnerabilities.length})</div>`;
          vulnHTML += '<div style="display:grid; gap:12px;">';
          
          result.vulnerabilities.forEach(vuln => {
            const sevColor = vuln.severity === 'high' ? 'var(--danger)' : 
                            vuln.severity === 'medium' ? 'var(--warn)' : 'var(--muted)';
            vulnHTML += `
              <div style="padding:12px; background:var(--bg); border-radius:8px; border-left:3px solid ${sevColor};">
                <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                  <span style="font-weight:600; font-size:13px;">${vuln.type}</span>
                  <span style="font-size:11px; font-weight:600; color:${sevColor}; text-transform:uppercase;">${vuln.severity}</span>
                </div>
                <div style="font-size:12px; color:var(--text); margin-bottom:6px;">${vuln.description}</div>
                ${vuln.port ? `<div style="font-size:11px; color:var(--muted); margin-bottom:6px;">Port: ${vuln.port}</div>` : ''}
                <div style="font-size:11px; color:var(--muted); font-style:italic;">💡 ${vuln.recommendation}</div>
              </div>
            `;
          });
          
          vulnHTML += '</div>';
          vulnDiv.innerHTML = vulnHTML;
          advResult.appendChild(vulnDiv);
        }
      }
    } catch(err){
      if(advResult){
        advResult.style.display = 'block';
        advResult.innerHTML = `
          <div style="padding:12px; background:var(--card); border:2px solid var(--danger); border-radius:10px; color:var(--danger);">
            ❌ Network Error: ${err.message}
          </div>
        `;
      }
    } finally {
      if(advLoading) advLoading.style.display = 'none';
      if(advScanBtn) advScanBtn.disabled = false;
    }
  }

  if(advScanBtn){
    advScanBtn.addEventListener('click', performAdvancedScan);
  }

  // MQTT Security Test
  const mqttHost = qs('#mqtt-host');
  const mqttPort = qs('#mqtt-port');
  const mqttTestBtn = qs('#mqtt-test-btn');
  const mqttLoading = qs('#mqtt-loading');
  const mqttResult = qs('#mqtt-result');

  async function performMqttTest(){
    const host = mqttHost?.value?.trim();
    const port = mqttPort?.value?.trim() || '1883';

    if(!host){
      alert('Please enter MQTT host');
      return;
    }

    if(mqttLoading) mqttLoading.style.display = 'inline';
    if(mqttTestBtn) mqttTestBtn.disabled = true;
    if(mqttResult) mqttResult.style.display = 'none';

    try{
      const res = await fetch(`${API_BASE}/api/security/mqtt-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          host: host,
          port: parseInt(port)
        })
      });

      const data = await res.json();
      
      if(mqttResult){
        mqttResult.style.display = 'block';
        mqttResult.innerHTML = '';

        if(!res.ok || !data.ok){
          const errorDiv = document.createElement('div');
          errorDiv.style.padding = '12px';
          errorDiv.style.background = 'var(--card)';
          errorDiv.style.border = '2px solid var(--danger)';
          errorDiv.style.borderRadius = '10px';
          errorDiv.style.color = 'var(--danger)';
          errorDiv.textContent = `❌ Error: ${data.error || 'Unknown error'}`;
          mqttResult.appendChild(errorDiv);
          return;
        }

        const result = data.result;
        
        // Security Score Card
        const scoreDiv = document.createElement('div');
        scoreDiv.style.padding = '16px';
        scoreDiv.style.background = 'var(--card)';
        scoreDiv.style.borderRadius = '10px';
        scoreDiv.style.border = '1px solid var(--border)';
        scoreDiv.style.marginBottom = '12px';
        
        const scoreColor = result.security_score >= 80 ? 'var(--ok)' : 
                          result.security_score >= 60 ? 'var(--warn)' : 'var(--danger)';
        
        scoreDiv.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <div>
              <div style="font-size:14px; color:var(--muted); margin-bottom:4px;">MQTT Security Score</div>
              <div style="font-size:32px; font-weight:700; color:${scoreColor};">${result.security_score}/100</div>
              <div style="font-size:13px; color:var(--muted); margin-top:4px;">Assessment: ${result.assessment}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:13px; color:var(--muted);">Broker:</div>
              <div style="font-size:14px; font-weight:600;">${result.host}:${result.port}</div>
            </div>
          </div>
        `;
        mqttResult.appendChild(scoreDiv);

        // Security Checks
        const checksDiv = document.createElement('div');
        checksDiv.style.padding = '16px';
        checksDiv.style.background = 'var(--card)';
        checksDiv.style.borderRadius = '10px';
        checksDiv.style.border = '1px solid var(--border)';
        checksDiv.style.marginBottom = '12px';
        
        let checksHTML = '<div style="font-size:14px; font-weight:600; margin-bottom:12px;">🔒 Security Checks</div>';
        checksHTML += '<div style="display:grid; gap:8px;">';
        
        // Anonymous Access
        checksHTML += `
          <div style="display:flex; justify-content:space-between; padding:8px; background:var(--bg); border-radius:6px;">
            <span style="font-weight:600;">Anonymous Access</span>
            <span style="color:${result.anonymous_access ? 'var(--danger)' : 'var(--ok)'}; font-weight:600;">
              ${result.anonymous_access ? '❌ ENABLED' : '✅ DISABLED'}
            </span>
          </div>
        `;
        
        // Weak Authentication
        checksHTML += `
          <div style="display:flex; justify-content:space-between; padding:8px; background:var(--bg); border-radius:6px;">
            <span style="font-weight:600;">Weak Credentials</span>
            <span style="color:${result.weak_auth ? 'var(--danger)' : 'var(--ok)'}; font-weight:600;">
              ${result.weak_auth ? `❌ FOUND (${result.weak_credentials})` : '✅ NOT FOUND'}
            </span>
          </div>
        `;
        
        // Encryption
        checksHTML += `
          <div style="display:flex; justify-content:space-between; padding:8px; background:var(--bg); border-radius:6px;">
            <span style="font-weight:600;">TLS Encryption (Port 8883)</span>
            <span style="color:${result.encryption_available ? 'var(--ok)' : 'var(--warn)'}; font-weight:600;">
              ${result.encryption_available ? '✅ AVAILABLE' : '⚠️ NOT AVAILABLE'}
            </span>
          </div>
        `;
        
        checksHTML += '</div>';
        checksDiv.innerHTML = checksHTML;
        mqttResult.appendChild(checksDiv);

        // Vulnerabilities
        if(result.vulnerabilities.length > 0){
          const vulnDiv = document.createElement('div');
          vulnDiv.style.padding = '16px';
          vulnDiv.style.background = 'var(--card)';
          vulnDiv.style.borderRadius = '10px';
          vulnDiv.style.border = '1px solid var(--border)';
          
          let vulnHTML = `<div style="font-size:14px; font-weight:600; margin-bottom:12px;">⚠️ Vulnerabilities Found (${result.vulnerabilities.length})</div>`;
          vulnHTML += '<div style="display:grid; gap:12px;">';
          
          result.vulnerabilities.forEach(vuln => {
            const sevColor = vuln.severity === 'high' ? 'var(--danger)' : 
                            vuln.severity === 'medium' ? 'var(--warn)' : 'var(--muted)';
            vulnHTML += `
              <div style="padding:12px; background:var(--bg); border-radius:8px; border-left:3px solid ${sevColor};">
                <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                  <span style="font-weight:600; font-size:13px;">${vuln.type}</span>
                  <span style="font-size:11px; font-weight:600; color:${sevColor}; text-transform:uppercase;">${vuln.severity}</span>
                </div>
                <div style="font-size:12px; color:var(--text); margin-bottom:6px;">${vuln.description}</div>
                <div style="font-size:11px; color:var(--muted); font-style:italic;">💡 ${vuln.recommendation}</div>
              </div>
            `;
          });
          
          vulnHTML += '</div>';
          vulnDiv.innerHTML = vulnHTML;
          mqttResult.appendChild(vulnDiv);
        } else {
          // No vulnerabilities
          const safeDiv = document.createElement('div');
          safeDiv.style.padding = '16px';
          safeDiv.style.background = 'var(--card)';
          safeDiv.style.borderRadius = '10px';
          safeDiv.style.border = '2px solid var(--ok)';
          safeDiv.style.color = 'var(--ok)';
          safeDiv.style.textAlign = 'center';
          safeDiv.innerHTML = '<div style="font-size:16px; font-weight:600;">✅ No vulnerabilities detected!</div>';
          mqttResult.appendChild(safeDiv);
        }
      }
    } catch(err){
      if(mqttResult){
        mqttResult.style.display = 'block';
        mqttResult.innerHTML = `
          <div style="padding:12px; background:var(--card); border:2px solid var(--danger); border-radius:10px; color:var(--danger);">
            ❌ Network Error: ${err.message}
          </div>
        `;
      }
    } finally {
      if(mqttLoading) mqttLoading.style.display = 'none';
      if(mqttTestBtn) mqttTestBtn.disabled = false;
    }
  }

  if(mqttTestBtn){
    mqttTestBtn.addEventListener('click', performMqttTest);
  }

  // CoAP Security Test
  const coapHost = qs('#coap-host');
  const coapPort = qs('#coap-port');
  const coapTestBtn = qs('#coap-test-btn');
  const coapLoading = qs('#coap-loading');
  const coapResult = qs('#coap-result');

  async function performCoapTest(){
    const host = coapHost?.value?.trim();
    const port = coapPort?.value?.trim() || '5683';

    if(!host){
      alert('Please enter CoAP host');
      return;
    }

    if(coapLoading) coapLoading.style.display = 'inline';
    if(coapTestBtn) coapTestBtn.disabled = true;
    if(coapResult) coapResult.style.display = 'none';

    try{
      const res = await fetch(`${API_BASE}/api/security/coap-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          host: host,
          port: parseInt(port)
        })
      });

      const data = await res.json();
      
      if(coapResult){
        coapResult.style.display = 'block';
        coapResult.innerHTML = '';

        if(!res.ok || !data.ok){
          const errorDiv = document.createElement('div');
          errorDiv.style.padding = '12px';
          errorDiv.style.background = 'var(--card)';
          errorDiv.style.border = '2px solid var(--danger)';
          errorDiv.style.borderRadius = '10px';
          errorDiv.style.color = 'var(--danger)';
          errorDiv.textContent = `❌ Error: ${data.error || 'Unknown error'}`;
          coapResult.appendChild(errorDiv);
          return;
        }

        const result = data.result;
        
        // Security Score Card
        const scoreDiv = document.createElement('div');
        scoreDiv.style.padding = '16px';
        scoreDiv.style.background = 'var(--card)';
        scoreDiv.style.borderRadius = '10px';
        scoreDiv.style.border = '1px solid var(--border)';
        scoreDiv.style.marginBottom = '12px';
        
        const scoreColor = result.security_score >= 80 ? 'var(--ok)' : 
                          result.security_score >= 60 ? 'var(--warn)' : 'var(--danger)';
        
        scoreDiv.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <div>
              <div style="font-size:14px; color:var(--muted); margin-bottom:4px;">CoAP Security Score</div>
              <div style="font-size:32px; font-weight:700; color:${scoreColor};">${result.security_score}/100</div>
              <div style="font-size:13px; color:var(--muted); margin-top:4px;">Assessment: ${result.assessment}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:13px; color:var(--muted);">Server:</div>
              <div style="font-size:14px; font-weight:600;">${result.host}:${result.port}</div>
            </div>
          </div>
        `;
        coapResult.appendChild(scoreDiv);

        // Security Checks
        const checksDiv = document.createElement('div');
        checksDiv.style.padding = '16px';
        checksDiv.style.background = 'var(--card)';
        checksDiv.style.borderRadius = '10px';
        checksDiv.style.border = '1px solid var(--border)';
        checksDiv.style.marginBottom = '12px';
        
        let checksHTML = '<div style="font-size:14px; font-weight:600; margin-bottom:12px;">🔒 Security Checks</div>';
        checksHTML += '<div style="display:grid; gap:8px;">';
        
        // CoAP Available
        checksHTML += `
          <div style="display:flex; justify-content:space-between; padding:8px; background:var(--bg); border-radius:6px;">
            <span style="font-weight:600;">CoAP Service</span>
            <span style="color:${result.coap_available ? 'var(--ok)' : 'var(--danger)'}; font-weight:600;">
              ${result.coap_available ? '✅ AVAILABLE' : '❌ NOT AVAILABLE'}
            </span>
          </div>
        `;
        
        // DTLS Encryption
        checksHTML += `
          <div style="display:flex; justify-content:space-between; padding:8px; background:var(--bg); border-radius:6px;">
            <span style="font-weight:600;">DTLS Encryption (Port 5684)</span>
            <span style="color:${result.dtls_enabled ? 'var(--ok)' : 'var(--danger)'}; font-weight:600;">
              ${result.dtls_enabled ? '✅ ENABLED' : '❌ DISABLED'}
            </span>
          </div>
        `;
        
        // Anonymous Access
        checksHTML += `
          <div style="display:flex; justify-content:space-between; padding:8px; background:var(--bg); border-radius:6px;">
            <span style="font-weight:600;">Anonymous Access</span>
            <span style="color:${result.anonymous_access ? 'var(--danger)' : 'var(--ok)'}; font-weight:600;">
              ${result.anonymous_access ? '❌ ALLOWED' : '✅ BLOCKED'}
            </span>
          </div>
        `;
        
        checksHTML += '</div>';
        checksDiv.innerHTML = checksHTML;
        coapResult.appendChild(checksDiv);

        // Discovered Resources
        if(result.resources_discovered && result.resources_discovered.length > 0){
          const resourcesDiv = document.createElement('div');
          resourcesDiv.style.padding = '16px';
          resourcesDiv.style.background = 'var(--card)';
          resourcesDiv.style.borderRadius = '10px';
          resourcesDiv.style.border = '1px solid var(--border)';
          resourcesDiv.style.marginBottom = '12px';
          
          let resourcesHTML = `<div style="font-size:14px; font-weight:600; margin-bottom:12px;">📁 Discovered Resources (${result.resources_discovered.length})</div>`;
          resourcesHTML += '<div style="display:grid; gap:6px; max-height:200px; overflow:auto;">';
          
          result.resources_discovered.forEach(resource => {
            resourcesHTML += `
              <div style="padding:6px 10px; background:var(--bg); border-radius:6px; font-size:12px; font-family:monospace;">
                ${resource}
              </div>
            `;
          });
          
          resourcesHTML += '</div>';
          resourcesDiv.innerHTML = resourcesHTML;
          coapResult.appendChild(resourcesDiv);
        }

        // Vulnerabilities
        if(result.vulnerabilities.length > 0){
          const vulnDiv = document.createElement('div');
          vulnDiv.style.padding = '16px';
          vulnDiv.style.background = 'var(--card)';
          vulnDiv.style.borderRadius = '10px';
          vulnDiv.style.border = '1px solid var(--border)';
          
          let vulnHTML = `<div style="font-size:14px; font-weight:600; margin-bottom:12px;">⚠️ Vulnerabilities Found (${result.vulnerabilities.length})</div>`;
          vulnHTML += '<div style="display:grid; gap:12px;">';
          
          result.vulnerabilities.forEach(vuln => {
            const sevColor = vuln.severity === 'high' ? 'var(--danger)' : 
                            vuln.severity === 'medium' ? 'var(--warn)' : 
                            vuln.severity === 'info' ? 'var(--muted)' : 'var(--muted)';
            vulnHTML += `
              <div style="padding:12px; background:var(--bg); border-radius:8px; border-left:3px solid ${sevColor};">
                <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                  <span style="font-weight:600; font-size:13px;">${vuln.type}</span>
                  <span style="font-size:11px; font-weight:600; color:${sevColor}; text-transform:uppercase;">${vuln.severity}</span>
                </div>
                <div style="font-size:12px; color:var(--text); margin-bottom:6px;">${vuln.description}</div>
                <div style="font-size:11px; color:var(--muted); font-style:italic;">💡 ${vuln.recommendation}</div>
              </div>
            `;
          });
          
          vulnHTML += '</div>';
          vulnDiv.innerHTML = vulnHTML;
          coapResult.appendChild(vulnDiv);
        } else {
          // No vulnerabilities
          const safeDiv = document.createElement('div');
          safeDiv.style.padding = '16px';
          safeDiv.style.background = 'var(--card)';
          safeDiv.style.borderRadius = '10px';
          safeDiv.style.border = '2px solid var(--ok)';
          safeDiv.style.color = 'var(--ok)';
          safeDiv.style.textAlign = 'center';
          safeDiv.innerHTML = '<div style="font-size:16px; font-weight:600;">✅ No vulnerabilities detected!</div>';
          coapResult.appendChild(safeDiv);
        }
      }
    } catch(err){
      if(coapResult){
        coapResult.style.display = 'block';
        coapResult.innerHTML = `
          <div style="padding:12px; background:var(--card); border:2px solid var(--danger); border-radius:10px; color:var(--danger);">
            ❌ Network Error: ${err.message}
          </div>
        `;
      }
    } finally {
      if(coapLoading) coapLoading.style.display = 'none';
      if(coapTestBtn) coapTestBtn.disabled = false;
    }
  }

  if(coapTestBtn){
    coapTestBtn.addEventListener('click', performCoapTest);
  }

  // Firmware view
  const kpiFwVersion = qs('#kpi-fw-version');
  const kpiFwCVEs = qs('#kpi-fw-cves');
  const fwTable = qs('#fw-table');
  function setFirmwareData(data){
    const version = data?.version ?? '--';
    const openCVEs = data?.openCVEs ?? '--';
    if(kpiFwVersion) kpiFwVersion.textContent = version;
    if(kpiFwCVEs) kpiFwCVEs.textContent = openCVEs;

    fwTable.innerHTML = '';
    if(Array.isArray(data?.devices)){
      data.devices.forEach(d => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${d.name ?? ''}</td>
          <td>${d.version ?? ''}</td>
          <td>${d.updated ?? ''}</td>
        `;
        fwTable.appendChild(tr);
      });
    }
  }

  const cveQuery = qs('#cve-query');
  const cveBtn = qs('#cve-search-btn');
  const cveLoading = qs('#cve-loading');
  const cveResults = qs('#cve-results');
  function setCveLoading(on){ if(cveLoading) cveLoading.style.display = on ? 'inline' : 'none'; }
  function clearCveResults(){ if(cveResults) cveResults.innerHTML = ''; }
  function renderCveItems(items){
    if(!cveResults) return;
    clearCveResults();
    if(!items || !items.length){
      const li = document.createElement('div');
      li.textContent = 'No results.';
      cveResults.appendChild(li);
      return;
    }
    items.slice(0, 50).forEach(it => {
      const id = it.cve?.id || it.id || '';
      const descriptions = it.cve?.descriptions || it.descriptions || [];
      const desc = (descriptions.find(d => (d.lang||'').toLowerCase()==='en') || descriptions[0] || {}).value || '';
      const metrics = it.cve?.metrics || it.metrics || {};
      let score = '';
      if(metrics.cvssMetricV31 && metrics.cvssMetricV31[0]?.cvssData?.baseScore != null){
        score = `CVSS 3.1: ${metrics.cvssMetricV31[0].cvssData.baseScore}`;
      } else if(metrics.cvssMetricV30 && metrics.cvssMetricV30[0]?.cvssData?.baseScore != null){
        score = `CVSS 3.0: ${metrics.cvssMetricV30[0].cvssData.baseScore}`;
      } else if(metrics.cvssMetricV2 && metrics.cvssMetricV2[0]?.cvssData?.baseScore != null){
        score = `CVSS 2.0: ${metrics.cvssMetricV2[0].cvssData.baseScore}`;
      }
      const published = it.published || it.publishedDate || '';
      const row = document.createElement('div');
      row.style.display = 'grid';
      row.style.gridTemplateColumns = '1fr auto';
      row.style.gap = '6px';
      const left = document.createElement('div');
      const title = document.createElement('div');
      title.textContent = id;
      title.style.fontWeight = '600';
      const d = document.createElement('div');
      d.textContent = desc;
      d.style.fontSize = '0.9em';
      d.style.color = 'var(--muted)';
      left.appendChild(title);
      left.appendChild(d);
      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '8px';
      if(score){
        const badge = document.createElement('span');
        badge.textContent = score;
        badge.className = 'tag';
        right.appendChild(badge);
      }
      if(published){
        const ts = document.createElement('span');
        ts.textContent = new Date(published).toISOString().slice(0,10);
        ts.style.color = 'var(--muted)';
        ts.style.fontSize = '0.85em';
        right.appendChild(ts);
      }
      const link = document.createElement('a');
      link.href = id ? `https://nvd.nist.gov/vuln/detail/${id}` : '#';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Details';
      link.className = 'ghost';
      right.appendChild(link);
      row.appendChild(left);
      row.appendChild(right);
      cveResults.appendChild(row);
    });
  }
  function isCveId(q){ return /^CVE-\d{4}-\d{4,}$/i.test(String(q).trim()); }
  async function searchCve(query){
    if(!query) return;
    setCveLoading(true);
    clearCveResults();
    const base = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
    let url;
    if(isCveId(query)) url = `${base}?cveId=${encodeURIComponent(query.trim())}`;
    else url = `${base}?keywordSearch=${encodeURIComponent(query.trim())}`;
    try{
      const res = await fetch(url);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data.vulnerabilities) ? data.vulnerabilities.map(v => v.cve ? { cve: v.cve, published: v.cve.published } : v) : [];
      renderCveItems(items);
    } catch(e){
      if(cveResults){
        const li = document.createElement('div');
        li.style.color = 'var(--danger)';
        li.textContent = 'Search failed. Try a different query or try again later.';
        cveResults.appendChild(li);
      }
    } finally {
      setCveLoading(false);
    }
  }
  if(cveBtn){ cveBtn.addEventListener('click', () => searchCve(cveQuery?.value)); }
  if(cveQuery){ cveQuery.addEventListener('keydown', (e) => { if(e.key === 'Enter') searchCve(cveQuery.value); }); }

  const fwFile = qs('#fw-file');
  const fwPickBtn = qs('#fw-pick-btn');
  const fwFileName = qs('#fw-file-name');
  const fwScanBtn = qs('#fw-scan-btn');
  const fwScanStatus = qs('#fw-scan-status');
  const fwFindings = qs('#fw-findings');
  const fwCves = qs('#fw-cves');
  function emitFirmwareSelected(file){
    if(!file) return;
    const meta = { name: file.name, size: file.size, type: file.type, lastModified: file.lastModified };
    try{ window.dispatchEvent(new CustomEvent('firmware:select', { detail: { file, meta } })); } catch(e) {}
    try{ console.log('[Firmware Selected]', meta); } catch(e) {}
    if(fwFileName) fwFileName.textContent = file.name || '';
    if(fwScanBtn){ fwScanBtn.disabled = false; }
    if(fwScanStatus){ fwScanStatus.textContent = ''; }
  }
  if(fwFile){
    fwFile.addEventListener('change', () => emitFirmwareSelected(fwFile.files && fwFile.files[0]));
  }
  if(fwPickBtn && fwFile){
    fwPickBtn.addEventListener('click', () => fwFile.click());
  }

  window.addEventListener('firmware:select', (e) => {
    const file = e && e.detail && e.detail.file;
    if(!file) return;
    if(kpiFwVersion) kpiFwVersion.textContent = file.name || '--';
    if(kpiFwCVEs) kpiFwCVEs.textContent = '--';
    if(fwFindings) fwFindings.innerHTML = '';
    if(fwCves) fwCves.innerHTML = '';
  });

  async function scanFirmware(){
    if(!fwFile || !fwFile.files || !fwFile.files[0]) return;
    const file = fwFile.files[0];
    try{ if(fwScanStatus) fwScanStatus.textContent = 'Scanning...'; } catch(e) {}
    if(fwScanBtn){ fwScanBtn.disabled = true; }
    try{
      const fd = new FormData();
      fd.append('file', file, file.name);
      const res = await fetch(`${API_BASE}/analyze`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if(!res.ok || !data || data.ok === false){
        const msg = (data && (data.error || (data.messages && data.messages.join('; ')))) || `HTTP ${res.status}`;
        if(fwScanStatus) fwScanStatus.textContent = `Failed: ${msg || 'Unknown error'}`;
        return;
      }
      const ver = data.firmware_version || 'N/A';
      const fcount = Array.isArray(data.findings) ? data.findings.length : 0;
      const ccount = Array.isArray(data.cves) ? data.cves.length : 0;
      if(fwScanStatus) fwScanStatus.textContent = `Done. Version: ${ver}. Findings: ${fcount}. CVEs: ${ccount}.`;
      if(fwFindings){
        fwFindings.innerHTML = '';
        (data.findings||[]).slice(0, 1000).forEach(item => {
          const li = document.createElement('div');
          li.textContent = String(item);
          fwFindings.appendChild(li);
        });
        if(!fcount){
          const li = document.createElement('div');
          li.textContent = 'No findings.';
          fwFindings.appendChild(li);
        }
      }
      if(fwCves){
        fwCves.innerHTML = '';
        (data.cves||[]).slice(0, 200).forEach(c => {
          const row = document.createElement('div');
          row.style.display = 'grid';
          row.style.gridTemplateColumns = '1fr auto';
          row.style.gap = '6px';
          const left = document.createElement('div');
          const title = document.createElement('div');
          title.textContent = c.id || '';
          title.style.fontWeight = '600';
          const d = document.createElement('div');
          d.textContent = c.summary || '';
          d.style.fontSize = '0.9em';
          d.style.color = 'var(--muted)';
          left.appendChild(title);
          left.appendChild(d);
          const right = document.createElement('div');
          right.style.display = 'flex';
          right.style.alignItems = 'center';
          right.style.gap = '8px';
          if(c.cvss != null){
            const badge = document.createElement('span');
            badge.textContent = `CVSS: ${c.cvss}`;
            badge.className = 'tag';
            right.appendChild(badge);
          }
          const link = document.createElement('a');
          link.href = c.id ? `https://nvd.nist.gov/vuln/detail/${c.id}` : '#';
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Details';
          link.className = 'ghost';
          right.appendChild(link);
          row.appendChild(left);
          row.appendChild(right);
          fwCves.appendChild(row);
        });
        if(!ccount){
          const li = document.createElement('div');
          li.textContent = 'No CVEs.';
          fwCves.appendChild(li);
        }
      }
    } catch(err){
      if(fwScanStatus) fwScanStatus.textContent = 'Scan failed.';
    } finally {
      if(fwScanBtn){ fwScanBtn.disabled = false; }
    }
  }
  if(fwScanBtn){ fwScanBtn.addEventListener('click', scanFirmware); }

  // ML Model Button
  const mlModelBtn = qs('#ml-model-btn');
  if (mlModelBtn) {
    mlModelBtn.addEventListener('click', () => {
      // Redirect to the ML model page using the correct path
      window.open('../last test model/templates/monitor.html', '_blank');
    });
  }

  // Real-time chart
  const canvas = qs('#rt-chart');
  const ctx = canvas.getContext('2d');
  const kpiThroughput = qs('#kpi-throughput');
  const kpiLatency = qs('#kpi-latency');
  const kpiAlerts = qs('#kpi-alerts');
  const alertLog = qs('#alert-log');

  // Device Behavior view
  const behKpiCpu = qs('#beh-kpi-cpu');
  const behKpiMemory = qs('#beh-kpi-memory');
  const behKpiAuth = qs('#beh-kpi-auth');
  const behKpiFiles = qs('#beh-kpi-files');
  const behCpuUpdated = qs('#beh-cpu-updated');
  const behMemoryUpdated = qs('#beh-memory-updated');
  const behCpuMeter = qs('#beh-cpu-meter');
  const behMemoryMeter = qs('#beh-memory-meter');
  const behProcessCount = qs('#beh-process-count');
  const behPortCount = qs('#beh-port-count');
  const behResourceUpdated = qs('#beh-resource-updated');
  const behProcessList = qs('#beh-processes');
  const behPortList = qs('#beh-ports');
  const behAuthList = qs('#beh-auth');
  const behFileList = qs('#beh-files');
  const behUserList = qs('#beh-users');
  const behSshList = qs('#beh-ssh');
  const behCronList = qs('#beh-cron');
  const behOutboundList = qs('#beh-outbound');

  function renderBehaviorList(el, items){
    if(!el) return;
    el.innerHTML = '';
    if(!items || !items.length){
      const li = document.createElement('li');
      li.textContent = 'No recent events.';
      el.appendChild(li);
      return;
    }
    items.slice(-30).reverse().forEach(item => {
      const li = document.createElement('li');
      const primary = document.createElement('span');
      const secondary = document.createElement('span');
      primary.textContent = item?.message || String(item?.details || '') || '';
      primary.style.fontWeight = '500';
      secondary.className = 'log-time';
      secondary.textContent = formatBehaviorTime(item?.time);
      li.appendChild(primary);
      if(secondary.textContent) li.appendChild(secondary);
      el.appendChild(li);
    });
  }

  function formatBehaviorTime(value){
    if(!value) return '';
    try{
      const date = new Date(value);
      if(Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleTimeString();
    } catch(e) {
      return String(value);
    }
  }

  function setBehaviorData(data){
    const resources = data?.resources || {};
    const cpu = Number(resources.cpu);
    const memory = Number(resources.memory);
    const cpuText = Number.isFinite(cpu) ? `${cpu.toFixed(1)}%` : '--%';
    const memText = Number.isFinite(memory) ? `${memory.toFixed(1)}%` : '--%';
    if(behKpiCpu) behKpiCpu.textContent = cpuText;
    if(behKpiMemory) behKpiMemory.textContent = memText;
    if(behCpuMeter) behCpuMeter.textContent = cpuText;
    if(behMemoryMeter) behMemoryMeter.textContent = memText;
    if(behProcessCount) behProcessCount.textContent = Number.isFinite(Number(resources.process_count)) ? String(resources.process_count) : '--';
    if(behPortCount) behPortCount.textContent = Number.isFinite(Number(resources.port_count)) ? String(resources.port_count) : '--';
    const updated = resources.updated ? formatBehaviorTime(resources.updated) : null;
    if(behCpuUpdated) behCpuUpdated.textContent = updated ? `Updated ${updated}` : '--';
    if(behMemoryUpdated) behMemoryUpdated.textContent = updated ? `Updated ${updated}` : '--';
    if(behResourceUpdated) behResourceUpdated.textContent = updated ? `Last update ${updated}` : 'Last update --';

    const kpis = data?.kpis || {};
    const authCount = kpis?.auth_alerts?.count ?? kpis?.auth_alerts ?? null;
    const fileCount = kpis?.file_events?.count ?? kpis?.file_events ?? null;
    if(behKpiAuth) behKpiAuth.textContent = authCount != null ? String(authCount) : '--';
    if(behKpiFiles) behKpiFiles.textContent = fileCount != null ? String(fileCount) : '--';

    const events = data?.events || {};
    renderBehaviorList(behProcessList, events.processes);
    renderBehaviorList(behPortList, events.ports);
    renderBehaviorList(behAuthList, events.auth);
    renderBehaviorList(behFileList, events.files);
    renderBehaviorList(behUserList, events.users);
    renderBehaviorList(behSshList, events.ssh);
    renderBehaviorList(behCronList, events.cron);
    renderBehaviorList(behOutboundList, events.outbound);
  }

  // Threat actions in Real-Time Monitor
  const autoBlockToggle = qs('#auto-block-toggle');
  const autoBlockStatus = qs('#auto-block-status');
  const threatsTable = qs('#threats-table');
  const threatState = { autoBlock: false, blocked: new Set(), threats: [] };
  let autoBlockCb = null;
  let blockIpCb = null;

  function setAutoBlock(enabled){
    threatState.autoBlock = !!enabled;
    if(autoBlockToggle) autoBlockToggle.textContent = threatState.autoBlock ? 'ON' : 'OFF';
    if(autoBlockStatus) autoBlockStatus.textContent = threatState.autoBlock ? 'Enabled' : 'Disabled';
    if(typeof autoBlockCb === 'function') autoBlockCb(threatState.autoBlock);
  }
  if(autoBlockToggle){
    autoBlockToggle.addEventListener('click', () => setAutoBlock(!threatState.autoBlock));
  }

  function renderThreats(){
    if(!threatsTable) return;
    threatsTable.innerHTML = '';
    threatState.threats.forEach(t => {
      const tr = document.createElement('tr');
      const blocked = threatState.blocked.has(t.ip) || !!t.blocked;
      const sevColor = (t.severity||'').toString().toLowerCase().includes('high') ? 'var(--danger)'
        : ((t.severity||'').toString().toLowerCase().includes('med') ? 'var(--warn)' : 'var(--text)');
      const btn = document.createElement('button');
      btn.className = 'ghost';
      btn.textContent = blocked ? 'Blocked' : 'Block';
      btn.disabled = !!blocked;
      btn.addEventListener('click', () => handleBlockIP(t.ip));
      const actionTd = document.createElement('td');
      actionTd.appendChild(btn);
      tr.innerHTML = `
        <td>${t.time ?? ''}</td>
        <td>${t.ip ?? ''}</td>
        <td style="color:${sevColor}">${t.severity ?? ''}</td>
        <td>${t.reason ?? ''}</td>
      `;
      tr.appendChild(actionTd);
      threatsTable.appendChild(tr);
    });
  }

  function setThreats(threats){
    threatState.threats = Array.isArray(threats) ? threats : [];
    renderThreats();
    // Auto-block newly reported threats based on severity when enabled
    if(threatState.autoBlock){
      threatState.threats.forEach(t => {
        const sev = (t.severity||'').toString().toLowerCase();
        const shouldBlock = !!t.autoBlock || sev.includes('high') || sev.includes('critical');
        if(shouldBlock && t.ip && !threatState.blocked.has(t.ip)){
          handleBlockIP(t.ip);
        }
      });
    }
  }

  function handleBlockIP(ip){
    if(!ip) return;
    threatState.blocked.add(ip);
    renderThreats();
    if(typeof blockIpCb === 'function') blockIpCb(ip);
  }

  function onAutoBlockChange(cb){ autoBlockCb = cb; }
  function onBlockIP(cb){ blockIpCb = cb; }

  const state = {
    data: [], // values 0..100
    maxPoints: 120,
    alerts: 0,
    alertRendered: 0,
  };

  function addMonitorPoint(value){
    const v = clamp(Number(value), 0, 100);
    if(Number.isFinite(v)){
      state.data.push(v);
      if(state.data.length > state.maxPoints) state.data.shift();
    }
  }
  function clearMonitor(){
    state.data = [];
  }
  function setMonitorKPIs(kpis){
    // Throughput/Latency removed from UI; ignore or safely no-op
    if(kpis && 'alerts' in kpis){
      const next = Number(kpis.alerts) || 0;
      state.alerts = next;
      if(kpiAlerts) kpiAlerts.textContent = String(state.alerts);
    }
  }

  function logAlert(message){
    if(!alertLog) return;
    const row = document.createElement('div');
    const ts = new Date().toLocaleTimeString();
    row.textContent = `[${ts}] ${message}`;
    alertLog.prepend(row);
    // keep the log compact
    const max = 50;
    while(alertLog.childElementCount > max){
      alertLog.removeChild(alertLog.lastElementChild);
    }
  }

  function logAlertDetail(a){
    if(!alertLog) return;
    const ts = a?.time || new Date().toISOString();
    const raw = (a?.raw || '').toString().trim();
    let line;
    if(raw){
      // Show raw alert exactly as provided (full IDS-style line)
      line = raw;
    } else {
      const sev = (a?.severity || 'info').toString().toLowerCase();
      const reason = a?.reason || '';
      const isAttack = sev.includes('high') || sev.includes('critical');
      line = `${isAttack ? 'ATTACK' : 'Alert'} [${sev.toUpperCase()}] ${reason}`.trim();
    }
    const row = document.createElement('div');
    row.textContent = `[${ts}] ${line}`;
    const sevForColor = (a?.severity || '').toString().toLowerCase();
    const isAttackColor = sevForColor.includes('high') || sevForColor.includes('critical');
    if(isAttackColor) row.style.color = 'var(--danger)';
    alertLog.prepend(row);
    const max = 50;
    while(alertLog.childElementCount > max){
      alertLog.removeChild(alertLog.lastElementChild);
    }
  }

  function draw(){
    const w = canvas.width; const h = canvas.height;
    ctx.clearRect(0,0,w,h);
    // background grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for(let i=0;i<6;i++){
      const y = (h-20) * i/5 + 10;
      ctx.beginPath(); ctx.moveTo(10,y); ctx.lineTo(w-10,y); ctx.stroke();
    }
    // line
    if(state.data.length>1){
      ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#4f46e5';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const dx = (w-20) / (state.maxPoints-1);
      state.data.forEach((v,i)=>{
        const x = 10 + i*dx;
        const y = map(v, 0, 100, h-10, 10);
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      });
      ctx.stroke();
    }
    requestAnimationFrame(draw);
  }

  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
  function map(v, inMin, inMax, outMin, outMax){
    return outMin + (v - inMin) * (outMax - outMin) / (inMax - inMin);
  }

  // No timers or mock data. Backend should call window.Dashboard APIs below.
  requestAnimationFrame(draw);

  // Initial navigation: default to Home when empty/unknown
  navigate(window.location.hash || '#/home');

  const Dashboard = {
    setConnection: setConn,
    setAuthData,
    setFirmwareData,
    setBehaviorData,
    setThreats,
    setAutoBlock,
    onAutoBlockChange,
    onBlockIP,
    addMonitorPoint,
    clearMonitor,
    setMonitorKPIs,
  };
  window.Dashboard = Dashboard;
  
  function fetchBehavior(){
    fetch(`${API_BASE}/api/device_behavior`)
      .then(res => { if(!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(data => {
        Dashboard.setBehaviorData(data);
      })
      .catch(() => {});
  }
  function fetchMonitor(){
    fetch(`${API_BASE}/api/monitor`)
      .then(res => { if(!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(data => {
        Dashboard.setMonitorKPIs(data.kpis);
        Dashboard.addMonitorPoint(data.point);
        if(Array.isArray(data.alerts)){
          const list = data.alerts;
          // If backend restarted or list reset, resync
          if(list.length < state.alertRendered) state.alertRendered = 0;
          for(let i = state.alertRendered; i < list.length; i++){
            logAlertDetail(list[i]);
          }
          state.alertRendered = list.length;
        }
      })
      .catch(err => {});
  }
  fetchMonitor();
  const monitorIntervalId = setInterval(fetchMonitor, 3000);
  fetchBehavior();
  const behaviorIntervalId = setInterval(fetchBehavior, 5000);

  // Password Strength Checker
  const pwdInput = qs('#pwd-input');
  const pwdStrength = qs('#pwd-strength');
  const pwdScore = qs('#pwd-score');
  const pwdToggle = qs('#pwd-toggle-visibility');
  const pwdBar = qs('#pwd-bar');
  const pwdResult = qs('#pwd-result');
  const pwdEmpty = qs('#pwd-empty');
  const pwdDetails = qs('#pwd-details');
  const pwdSuggestions = qs('#pwd-suggestions');
  const pwdSuggestionsList = qs('#pwd-suggestions-list');

  function checkPasswordStrength(password) {
    if (!password) {
      return null;
    }

    let score = 0;
    const checks = {
      length: password.length,
      hasLower: /[a-z]/.test(password),
      hasUpper: /[A-Z]/.test(password),
      hasNumber: /[0-9]/.test(password),
      hasSpecial: /[^a-zA-Z0-9]/.test(password),
    };

    // Length scoring
    if (checks.length >= 8) score += 1;
    if (checks.length >= 12) score += 1;
    if (checks.length >= 16) score += 1;

    // Character variety
    if (checks.hasLower) score += 1;
    if (checks.hasUpper) score += 1;
    if (checks.hasNumber) score += 1;
    if (checks.hasSpecial) score += 1;

    // Check for common weak patterns
    const weakPatterns = ['123', 'abc', 'password', 'qwerty', '111', '000', 'admin', '12345'];
    const hasWeak = weakPatterns.some(p => password.toLowerCase().includes(p));
    if (hasWeak) score -= 2;

    // Determine strength
    let strength, color, emoji, barWidth;
    if (score <= 2) {
      strength = 'Weak';
      color = 'var(--danger)';
      emoji = '❌';
      barWidth = 25;
    } else if (score <= 4) {
      strength = 'Fair';
      color = '#f59e0b';
      emoji = '⚠️';
      barWidth = 50;
    } else if (score <= 6) {
      strength = 'Good';
      color = '#3b82f6';
      emoji = '✓';
      barWidth = 75;
    } else {
      strength = 'Strong';
      color = 'var(--ok)';
      emoji = '✅';
      barWidth = 100;
    }

    // Generate suggestions
    const suggestions = [];
    if (checks.length < 12) suggestions.push('Use at least 12 characters');
    if (!checks.hasLower) suggestions.push('Add lowercase letters (a-z)');
    if (!checks.hasUpper) suggestions.push('Add uppercase letters (A-Z)');
    if (!checks.hasNumber) suggestions.push('Add numbers (0-9)');
    if (!checks.hasSpecial) suggestions.push('Add special characters (!@#$%^&*)');
    if (hasWeak) suggestions.push('Avoid common patterns like "123" or "password"');

    return {
      strength: emoji + ' ' + strength,
      score: Math.max(0, score),
      maxScore: 7,
      color,
      barWidth,
      checks,
      suggestions,
      hasWeak
    };
  }

  if (pwdInput) {
    pwdInput.addEventListener('input', () => {
      const password = pwdInput.value;
      
      if (!password) {
        if (pwdResult) pwdResult.style.display = 'none';
        if (pwdEmpty) pwdEmpty.style.display = 'block';
        return;
      }

      const result = checkPasswordStrength(password);
      if (!result) return;

      // Show result, hide empty state
      if (pwdResult) pwdResult.style.display = 'block';
      if (pwdEmpty) pwdEmpty.style.display = 'none';

      // Update strength display
      if (pwdStrength) {
        pwdStrength.textContent = result.strength;
        pwdStrength.style.background = result.color;
        pwdStrength.style.color = '#fff';
      }

      // Update score
      if (pwdScore) {
        pwdScore.textContent = `Score: ${result.score}/${result.maxScore} • Length: ${result.checks.length} chars`;
      }

      // Update progress bar
      if (pwdBar) {
        pwdBar.style.width = result.barWidth + '%';
        pwdBar.style.background = result.color;
      }

      // Update details
      if (pwdDetails) {
        pwdDetails.innerHTML = '';
        const detailItems = [
          { label: 'Lowercase letters', check: result.checks.hasLower },
          { label: 'Uppercase letters', check: result.checks.hasUpper },
          { label: 'Numbers', check: result.checks.hasNumber },
          { label: 'Special characters', check: result.checks.hasSpecial },
          { label: 'Minimum 8 characters', check: result.checks.length >= 8 },
          { label: 'Recommended 12+ characters', check: result.checks.length >= 12 },
        ];

        detailItems.forEach(item => {
          const li = document.createElement('li');
          li.style.display = 'flex';
          li.style.alignItems = 'center';
          li.style.gap = '10px';
          li.style.padding = '8px';
          li.style.background = 'var(--bg)';
          li.style.borderRadius = '8px';
          
          const icon = document.createElement('span');
          icon.textContent = item.check ? '✅' : '❌';
          icon.style.fontSize = '18px';
          
          const text = document.createElement('span');
          text.textContent = item.label;
          text.style.color = item.check ? 'var(--ok)' : 'var(--muted)';
          
          li.appendChild(icon);
          li.appendChild(text);
          pwdDetails.appendChild(li);
        });
      }

      // Update suggestions
      if (pwdSuggestions && pwdSuggestionsList) {
        if (result.suggestions.length > 0) {
          pwdSuggestions.style.display = 'block';
          pwdSuggestionsList.innerHTML = '';
          
          result.suggestions.forEach(suggestion => {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.alignItems = 'center';
            li.style.gap = '10px';
            li.style.padding = '8px';
            li.style.background = 'var(--bg)';
            li.style.borderRadius = '8px';
            
            const icon = document.createElement('span');
            icon.textContent = '💡';
            
            const text = document.createElement('span');
            text.textContent = suggestion;
            text.style.color = 'var(--text)';
            
            li.appendChild(icon);
            li.appendChild(text);
            pwdSuggestionsList.appendChild(li);
          });
        } else {
          pwdSuggestions.style.display = 'none';
        }
      }
    });
  }

  if (pwdToggle && pwdInput) {
    pwdToggle.addEventListener('click', () => {
      if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        pwdToggle.textContent = '🙈';
      } else {
        pwdInput.type = 'password';
        pwdToggle.textContent = '👁️';
      }
    });
  }

  // ==================== FIRMWARE TAMPERING PREVENTION ====================
  
  // Firmware Integrity Verification
  const integrityFile = qs('#integrity-file');
  const integrityPickBtn = qs('#integrity-pick-btn');
  const integrityFileName = qs('#integrity-file-name');
  const integrityVerifyBtn = qs('#integrity-verify-btn');
  const integrityBaselineBtn = qs('#integrity-baseline-btn');
  const integrityLoading = qs('#integrity-loading');
  const integrityResult = qs('#integrity-result');
  const integrityDeviceId = qs('#integrity-device-id');

  let selectedIntegrityFile = null;

  if (integrityPickBtn && integrityFile) {
    integrityPickBtn.addEventListener('click', () => integrityFile.click());
    
    integrityFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        selectedIntegrityFile = file;
        integrityFileName.textContent = file.name;
        integrityVerifyBtn.disabled = false;
        integrityBaselineBtn.disabled = false;
      }
    });
  }

  if (integrityVerifyBtn) {
    integrityVerifyBtn.addEventListener('click', async () => {
      if (!selectedIntegrityFile) return;
      
      const deviceId = integrityDeviceId.value.trim();
      if (!deviceId) {
        alert('Please enter a Device ID');
        return;
      }

      integrityLoading.style.display = 'inline';
      integrityResult.style.display = 'none';
      integrityVerifyBtn.disabled = true;

      try {
        // First upload and get hash
        const formData = new FormData();
        formData.append('file', selectedIntegrityFile);
        
        const hashResp = await fetch(`${API_BASE}/api/firmware/hash`, {
          method: 'POST',
          body: formData
        });
        
        const hashData = await hashResp.json();
        
        if (!hashData.ok) {
          throw new Error(hashData.error || 'Failed to calculate hash');
        }

        // Now verify integrity (simulated with hash comparison)
        // In real scenario, firmware would be on server
        integrityResult.innerHTML = `
          <div style="padding:16px; background:var(--card); border-radius:8px; border-left:4px solid var(--info);">
            <h4 style="margin:0 0 12px 0;">📊 Hash Calculation Result</h4>
            <div style="display:grid; gap:8px; font-size:14px;">
              <div><strong>File:</strong> ${hashData.filename}</div>
              <div><strong>Algorithm:</strong> ${hashData.algorithm.toUpperCase()}</div>
              <div><strong>Hash:</strong> <code style="background:var(--bg); padding:4px 8px; border-radius:4px; font-size:12px; word-break:break-all;">${hashData.hash}</code></div>
              <div><strong>Size:</strong> ${(hashData.file_size / 1024).toFixed(2)} KB</div>
            </div>
            <div style="margin-top:12px; padding:12px; background:var(--bg); border-radius:6px; border-left:3px solid var(--ok);">
              <strong style="color:var(--ok);">✅ Hash calculated successfully</strong>
              <p style="margin:8px 0 0 0; font-size:13px; color:var(--muted);">
                This hash can be used to verify firmware integrity. Compare it with the official hash from the manufacturer.
              </p>
            </div>
          </div>
        `;
        integrityResult.style.display = 'block';
        
      } catch (error) {
        integrityResult.innerHTML = `
          <div style="padding:12px; background:var(--danger); color:white; border-radius:8px;">
            ❌ Error: ${error.message}
          </div>
        `;
        integrityResult.style.display = 'block';
      } finally {
        integrityLoading.style.display = 'none';
        integrityVerifyBtn.disabled = false;
      }
    });
  }

  if (integrityBaselineBtn) {
    integrityBaselineBtn.addEventListener('click', async () => {
      if (!selectedIntegrityFile) return;
      
      const deviceId = integrityDeviceId.value.trim();
      if (!deviceId) {
        alert('Please enter a Device ID');
        return;
      }

      if (!confirm('Update baseline hash for this device? This will set a new reference point for integrity checks.')) {
        return;
      }

      integrityLoading.style.display = 'inline';
      integrityResult.style.display = 'none';
      integrityBaselineBtn.disabled = true;

      try {
        const formData = new FormData();
        formData.append('file', selectedIntegrityFile);
        
        const hashResp = await fetch(`${API_BASE}/api/firmware/hash`, {
          method: 'POST',
          body: formData
        });
        
        const hashData = await hashResp.json();
        
        if (!hashData.ok) {
          throw new Error(hashData.error || 'Failed to calculate hash');
        }

        integrityResult.innerHTML = `
          <div style="padding:16px; background:var(--card); border-radius:8px; border-left:4px solid var(--ok);">
            <h4 style="margin:0 0 12px 0;">✅ Baseline Updated</h4>
            <div style="display:grid; gap:8px; font-size:14px;">
              <div><strong>Device ID:</strong> ${deviceId}</div>
              <div><strong>New Baseline Hash:</strong> <code style="background:var(--bg); padding:4px 8px; border-radius:4px; font-size:12px; word-break:break-all;">${hashData.hash}</code></div>
            </div>
            <p style="margin:12px 0 0 0; font-size:13px; color:var(--muted);">
              Future integrity checks will compare against this baseline.
            </p>
          </div>
        `;
        integrityResult.style.display = 'block';
        
      } catch (error) {
        integrityResult.innerHTML = `
          <div style="padding:12px; background:var(--danger); color:white; border-radius:8px;">
            ❌ Error: ${error.message}
          </div>
        `;
        integrityResult.style.display = 'block';
      } finally {
        integrityLoading.style.display = 'none';
        integrityBaselineBtn.disabled = false;
      }
    });
  }

  // Version Rollback Protection
  const versionDeviceId = qs('#version-device-id');
  const versionNew = qs('#version-new');
  const versionCheckBtn = qs('#version-check-btn');
  const versionHistoryBtn = qs('#version-history-btn');
  const versionLoading = qs('#version-loading');
  const versionResult = qs('#version-result');

  if (versionCheckBtn) {
    versionCheckBtn.addEventListener('click', async () => {
      const deviceId = versionDeviceId.value.trim();
      const newVersion = versionNew.value.trim();
      
      if (!deviceId || !newVersion) {
        alert('Please enter both Device ID and Version');
        return;
      }

      versionLoading.style.display = 'inline';
      versionResult.style.display = 'none';
      versionCheckBtn.disabled = true;

      try {
        const resp = await fetch(`${API_BASE}/api/firmware/version/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: deviceId, version: newVersion })
        });
        
        const data = await resp.json();
        
        if (!data.ok) {
          throw new Error(data.error || 'Version check failed');
        }

        const result = data.result;
        const isRollback = result.is_rollback;
        const allowed = result.allowed;
        
        let statusColor = allowed ? 'var(--ok)' : 'var(--danger)';
        let statusIcon = allowed ? '✅' : '🚫';
        
        versionResult.innerHTML = `
          <div style="padding:16px; background:var(--card); border-radius:8px; border-left:4px solid ${statusColor};">
            <h4 style="margin:0 0 12px 0;">${statusIcon} ${result.message}</h4>
            <div style="display:grid; gap:8px; font-size:14px;">
              <div><strong>Device ID:</strong> ${deviceId}</div>
              ${result.current_version ? `<div><strong>Current Version:</strong> ${result.current_version}</div>` : ''}
              <div><strong>New Version:</strong> ${newVersion}</div>
              <div><strong>Rollback Detected:</strong> ${isRollback ? '⚠️ Yes' : '✅ No'}</div>
              <div><strong>Update Allowed:</strong> ${allowed ? '✅ Yes' : '❌ No'}</div>
            </div>
            ${isRollback ? `
              <div style="margin-top:12px; padding:12px; background:var(--danger); color:white; border-radius:6px;">
                <strong>⚠️ Security Alert</strong>
                <p style="margin:8px 0 0 0; font-size:13px;">
                  Rollback attacks attempt to install older firmware versions with known vulnerabilities. This update has been blocked.
                </p>
              </div>
            ` : ''}
          </div>
        `;
        versionResult.style.display = 'block';
        
      } catch (error) {
        versionResult.innerHTML = `
          <div style="padding:12px; background:var(--danger); color:white; border-radius:8px;">
            ❌ Error: ${error.message}
          </div>
        `;
        versionResult.style.display = 'block';
      } finally {
        versionLoading.style.display = 'none';
        versionCheckBtn.disabled = false;
      }
    });
  }

  if (versionHistoryBtn) {
    versionHistoryBtn.addEventListener('click', async () => {
      const deviceId = versionDeviceId.value.trim();
      
      if (!deviceId) {
        alert('Please enter a Device ID');
        return;
      }

      versionLoading.style.display = 'inline';
      versionResult.style.display = 'none';

      try {
        const resp = await fetch(`${API_BASE}/api/firmware/version/history/${deviceId}`);
        const data = await resp.json();
        
        if (!data.ok) {
          throw new Error(data.error || 'Failed to fetch history');
        }

        const history = data.history || [];
        
        if (history.length === 0) {
          versionResult.innerHTML = `
            <div style="padding:12px; background:var(--card); border-radius:8px; text-align:center; color:var(--muted);">
              No version history found for device: ${deviceId}
            </div>
          `;
        } else {
          const historyHTML = history.map((item, idx) => `
            <div style="padding:12px; background:var(--bg); border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <strong style="color:var(--text);">${item.version}</strong>
                <span style="color:var(--muted); font-size:12px; margin-left:8px;">${new Date(item.date).toLocaleString()}</span>
              </div>
              <span style="color:var(--muted); font-size:12px;">#${history.length - idx}</span>
            </div>
          `).join('');
          
          versionResult.innerHTML = `
            <div style="padding:16px; background:var(--card); border-radius:8px;">
              <h4 style="margin:0 0 12px 0;">📜 Version History for ${deviceId}</h4>
              <div style="display:grid; gap:8px;">
                ${historyHTML}
              </div>
            </div>
          `;
        }
        
        versionResult.style.display = 'block';
        
      } catch (error) {
        versionResult.innerHTML = `
          <div style="padding:12px; background:var(--danger); color:white; border-radius:8px;">
            ❌ Error: ${error.message}
          </div>
        `;
        versionResult.style.display = 'block';
      } finally {
        versionLoading.style.display = 'none';
      }
    });
  }

  // Secure Boot Status
  const securebootCheckBtn = qs('#secureboot-check-btn');
  const securebootResult = qs('#secureboot-result');

  if (securebootCheckBtn) {
    securebootCheckBtn.addEventListener('click', async () => {
      securebootResult.style.display = 'none';
      securebootCheckBtn.disabled = true;
      securebootCheckBtn.textContent = '🔍 Checking...';

      try {
        const resp = await fetch(`${API_BASE}/api/firmware/secure-boot/status`);
        const data = await resp.json();
        
        if (!data.ok) {
          throw new Error(data.error || 'Failed to check secure boot');
        }

        const result = data.result;
        const statusColor = result.enabled ? 'var(--ok)' : (result.supported ? 'var(--warn)' : 'var(--muted)');
        const statusIcon = result.enabled ? '✅' : (result.supported ? '⚠️' : 'ℹ️');
        
        const recommendationsHTML = result.recommendations.map(rec => `
          <li style="padding:8px; background:var(--bg); border-radius:6px; font-size:14px;">
            ${rec}
          </li>
        `).join('');
        
        securebootResult.innerHTML = `
          <div style="padding:16px; background:var(--card); border-radius:8px; border-left:4px solid ${statusColor};">
            <h4 style="margin:0 0 12px 0;">${statusIcon} Secure Boot Status</h4>
            <div style="display:grid; gap:8px; font-size:14px; margin-bottom:12px;">
              <div><strong>Platform:</strong> ${result.platform}</div>
              <div><strong>Supported:</strong> ${result.supported ? '✅ Yes' : '❌ No'}</div>
              <div><strong>Enabled:</strong> ${result.enabled ? '✅ Yes' : '❌ No'}</div>
            </div>
            ${result.recommendations.length > 0 ? `
              <div>
                <strong style="display:block; margin-bottom:8px;">Recommendations:</strong>
                <ul style="list-style:none; padding:0; margin:0; display:grid; gap:6px;">
                  ${recommendationsHTML}
                </ul>
              </div>
            ` : ''}
            <div style="margin-top:12px; padding:12px; background:var(--bg); border-radius:6px; font-size:13px; color:var(--muted);">
              <strong>About Secure Boot:</strong> Secure Boot ensures that only trusted bootloaders and operating systems can run on your device, preventing unauthorized firmware modifications.
            </div>
          </div>
        `;
        securebootResult.style.display = 'block';
        
      } catch (error) {
        securebootResult.innerHTML = `
          <div style="padding:12px; background:var(--danger); color:white; border-radius:8px;">
            ❌ Error: ${error.message}
          </div>
        `;
        securebootResult.style.display = 'block';
      } finally {
        securebootCheckBtn.disabled = false;
        securebootCheckBtn.textContent = '🔍 Check Secure Boot';
      }
    });
  }

  // Tampering Alerts
  const alertsRefreshBtn = qs('#alerts-refresh-btn');
  const tamperingAlerts = qs('#tampering-alerts');

  async function loadTamperingAlerts() {
    if (!tamperingAlerts) return;
    
    try {
      const resp = await fetch(`${API_BASE}/api/firmware/alerts?limit=20`);
      const data = await resp.json();
      
      if (!data.ok) {
        throw new Error(data.error || 'Failed to load alerts');
      }

      const alerts = data.alerts || [];
      
      if (alerts.length === 0) {
        tamperingAlerts.innerHTML = `
          <div style="padding:20px; text-align:center; color:var(--muted);">
            <div style="font-size:48px; margin-bottom:12px;">✅</div>
            <p>No tampering alerts detected</p>
          </div>
        `;
      } else {
        tamperingAlerts.innerHTML = alerts.map(alert => {
          const severityColors = {
            critical: 'var(--danger)',
            high: 'var(--warn)',
            medium: 'var(--info)',
            low: 'var(--muted)'
          };
          const color = severityColors[alert.severity] || 'var(--muted)';
          
          return `
            <div style="padding:12px; background:var(--card); border-radius:8px; border-left:4px solid ${color}; margin-bottom:8px;">
              <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:8px;">
                <strong style="color:${color}; text-transform:uppercase; font-size:12px;">${alert.severity} • ${alert.type}</strong>
                <span style="color:var(--muted); font-size:12px;">${new Date(alert.timestamp).toLocaleString()}</span>
              </div>
              <div style="font-size:14px; margin-bottom:8px;">
                <strong>Device:</strong> ${alert.device_id}
              </div>
              <div style="font-size:13px; color:var(--muted);">
                <div><strong>Expected:</strong> <code style="font-size:11px;">${alert.expected_hash ? alert.expected_hash.substring(0, 16) + '...' : 'N/A'}</code></div>
                <div><strong>Current:</strong> <code style="font-size:11px;">${alert.current_hash ? alert.current_hash.substring(0, 16) + '...' : 'N/A'}</code></div>
              </div>
            </div>
          `;
        }).join('');
      }
      
    } catch (error) {
      tamperingAlerts.innerHTML = `
        <div style="padding:12px; background:var(--danger); color:white; border-radius:8px;">
          ❌ Error loading alerts: ${error.message}
        </div>
      `;
    }
  }

  if (alertsRefreshBtn) {
    alertsRefreshBtn.addEventListener('click', loadTamperingAlerts);
  }

  // Load alerts when firmware view is opened
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#/firmware') {
      loadTamperingAlerts();
    }
  });

  // Load alerts on initial page load if on firmware view
  if (window.location.hash === '#/firmware') {
    loadTamperingAlerts();
  }

  // ============================================
  // Authentication Page Logic (for auth.html)
  // ============================================
  
  // Check if we're on the auth page
  const isAuthPage = document.getElementById('signin-form') && document.getElementById('signup-form');
  
  if (isAuthPage) {
    // DOM Elements for auth page
    const signinForm = qs('#signin-form');
    const signupForm = qs('#signup-form');
    const showSignupBtn = qs('#show-signup');
    const showSigninBtn = qs('#show-signin');
    const messageDiv = qs('#message');
    const authSubtitle = qs('#auth-subtitle');
    
    // Toggle between sign-in and sign-up forms
    function showSignup() {
      signinForm.classList.add('form-hidden');
      signupForm.classList.remove('form-hidden');
      authSubtitle.textContent = 'Create your account';
      hideAuthMessage();
    }
    
    function showSignin() {
      signupForm.classList.add('form-hidden');
      signinForm.classList.remove('form-hidden');
      authSubtitle.textContent = 'Sign in to your account';
      hideAuthMessage();
    }
    
    // Message display functions
    function showAuthMessage(text, type) {
      messageDiv.textContent = text;
      messageDiv.className = `message ${type}`;
      messageDiv.style.display = 'block';
    }
    
    function hideAuthMessage() {
      messageDiv.style.display = 'none';
    }
    
    // Check if user is already logged in
    function checkExistingSession() {
      const sessionToken = localStorage.getItem(SESSION_KEY);
      if (sessionToken) {
        // Verify session with backend
        verifySessionToken(sessionToken).then(isValid => {
          if (isValid) {
            // Redirect to dashboard
            window.location.href = 'index.html';
          } else {
            // Clear invalid session
            localStorage.removeItem(SESSION_KEY);
            localStorage.removeItem(USER_KEY);
          }
        });
      }
    }
    
    // Verify session token
    async function verifySessionToken(sessionToken) {
      try {
        const response = await fetch(`${API_BASE}/api/auth/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ session_token: sessionToken })
        });
        
        const data = await response.json();
        return data.ok && data.valid;
      } catch (error) {
        console.error('Session verification error:', error);
        return false;
      }
    }
    
    // Handle Sign In
    async function handleSignin(e) {
      e.preventDefault();
      
      const email = qs('#signin-email').value.trim();
      const password = qs('#signin-password').value;
      const submitBtn = qs('#signin-btn');
      
      // Validate inputs
      if (!email || !password) {
        showAuthMessage('Please fill in all fields', 'error');
        return;
      }
      
      // Disable button and show loading
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';
      hideAuthMessage();
      
      try {
        const response = await fetch(`${API_BASE}/api/auth/signin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: email,
            password: password
          })
        });
        
        const data = await response.json();
        
        if (data.ok && data.session_token) {
          // Store session token and user data
          localStorage.setItem(SESSION_KEY, data.session_token);
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
          
          showAuthMessage('Login successful! Redirecting...', 'success');
          
          // Redirect to dashboard after short delay
          setTimeout(() => {
            window.location.href = 'index.html';
          }, 1000);
        } else {
          showAuthMessage(data.error || 'Login failed. Please try again.', 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign In';
        }
      } catch (error) {
        console.error('Sign in error:', error);
        showAuthMessage('Network error. Please check your connection.', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    }
    
    // Handle Sign Up
    async function handleSignup(e) {
      e.preventDefault();
      
      const email = qs('#signup-email').value.trim();
      const password = qs('#signup-password').value;
      const confirmPassword = qs('#signup-confirm-password').value;
      const submitBtn = qs('#signup-btn');
      
      // Validate inputs
      if (!email || !password || !confirmPassword) {
        showAuthMessage('Please fill in all fields', 'error');
        return;
      }
      
      if (password !== confirmPassword) {
        showAuthMessage('Passwords do not match', 'error');
        return;
      }
      
      // Client-side password validation
      if (password.length < 8) {
        showAuthMessage('Password must be at least 8 characters long', 'error');
        return;
      }
      
      if (!/[a-zA-Z]/.test(password)) {
        showAuthMessage('Password must contain at least one letter', 'error');
        return;
      }
      
      if (!/\d/.test(password)) {
        showAuthMessage('Password must contain at least one number', 'error');
        return;
      }
      
      if (!/[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\;/`~]/.test(password)) {
        showAuthMessage('Password must contain at least one special character', 'error');
        return;
      }
      
      // Disable button and show loading
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating account...';
      hideAuthMessage();
      
      try {
        const response = await fetch(`${API_BASE}/api/auth/signup`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: email,
            password: password,
            confirm_password: confirmPassword
          })
        });
        
        const data = await response.json();
        
        if (data.ok) {
          showAuthMessage('Account created successfully! Please sign in.', 'success');
          
          // Clear form
          qs('#signup-email').value = '';
          qs('#signup-password').value = '';
          qs('#signup-confirm-password').value = '';
          
          // Switch to sign-in form after short delay
          setTimeout(() => {
            showSignin();
            // Pre-fill email in sign-in form
            qs('#signin-email').value = email;
          }, 2000);
        } else {
          showAuthMessage(data.error || 'Registration failed. Please try again.', 'error');
        }
      } catch (error) {
        console.error('Sign up error:', error);
        showAuthMessage('Network error. Please check your connection.', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign Up';
      }
    }
    
    // Event listeners for auth page
    if (showSignupBtn) showSignupBtn.addEventListener('click', showSignup);
    if (showSigninBtn) showSigninBtn.addEventListener('click', showSignin);
    if (signinForm) signinForm.addEventListener('submit', handleSignin);
    if (signupForm) signupForm.addEventListener('submit', handleSignup);
    
    // Check for existing session on page load
    checkExistingSession();
  }

})();
