(function() {
  const API_BASE = 'http://localhost:5000';
  
  // DOM Elements
  const signinForm = document.getElementById('signin-form');
  const signupForm = document.getElementById('signup-form');
  const showSignupBtn = document.getElementById('show-signup');
  const showSigninBtn = document.getElementById('show-signin');
  const messageDiv = document.getElementById('message');
  const authSubtitle = document.getElementById('auth-subtitle');
  
  // Session storage key
  const SESSION_KEY = 'iot_session_token';
  const USER_KEY = 'iot_user_data';
  
  // Toggle between sign-in and sign-up forms
  function showSignup() {
    signinForm.classList.add('form-hidden');
    signupForm.classList.remove('form-hidden');
    authSubtitle.textContent = 'Create your account';
    hideMessage();
  }
  
  function showSignin() {
    signupForm.classList.add('form-hidden');
    signinForm.classList.remove('form-hidden');
    authSubtitle.textContent = 'Sign in to your account';
    hideMessage();
  }
  
  // Message display functions
  function showMessage(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = 'block';
  }
  
  function hideMessage() {
    messageDiv.style.display = 'none';
  }
  
  // Check if user is already logged in
  function checkExistingSession() {
    const sessionToken = localStorage.getItem(SESSION_KEY);
    if (sessionToken) {
      // Verify session with backend
      verifySession(sessionToken).then(isValid => {
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
  async function verifySession(sessionToken) {
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
    
    const email = document.getElementById('signin-email').value.trim();
    const password = document.getElementById('signin-password').value;
    const submitBtn = document.getElementById('signin-btn');
    
    // Validate inputs
    if (!email || !password) {
      showMessage('Please fill in all fields', 'error');
      return;
    }
    
    // Disable button and show loading
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';
    hideMessage();
    
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
        
        showMessage('Login successful! Redirecting...', 'success');
        
        // Redirect to dashboard after short delay
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 1000);
      } else {
        showMessage(data.error || 'Login failed. Please try again.', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    } catch (error) {
      console.error('Sign in error:', error);
      showMessage('Network error. Please check your connection.', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  }
  
  // Handle Sign Up
  async function handleSignup(e) {
    e.preventDefault();
    
    const username = document.getElementById('signup-username').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm-password').value;
    const submitBtn = document.getElementById('signup-btn');
    
    // Validate inputs
    if (!username || !email || !password || !confirmPassword) {
      showMessage('Please fill in all fields', 'error');
      return;
    }
    
    if (password !== confirmPassword) {
      showMessage('Passwords do not match', 'error');
      return;
    }
    
    // Client-side password validation
    if (password.length < 8) {
      showMessage('Password must be at least 8 characters long', 'error');
      return;
    }
    
    if (!/[a-zA-Z]/.test(password)) {
      showMessage('Password must contain at least one letter', 'error');
      return;
    }
    
    if (!/\d/.test(password)) {
      showMessage('Password must contain at least one number', 'error');
      return;
    }
    
    if (!/[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\;/`~]/.test(password)) {
      showMessage('Password must contain at least one special character', 'error');
      return;
    }
    
    // Disable button and show loading
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account...';
    hideMessage();
    
    try {
      const response = await fetch(`${API_BASE}/api/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: username,
          email: email,
          password: password,
          confirm_password: confirmPassword
        })
      });
      
      const data = await response.json();
      
      if (data.ok) {
        showMessage('Account created successfully! Please sign in.', 'success');
        
        // Clear form
        document.getElementById('signup-email').value = '';
        document.getElementById('signup-password').value = '';
        document.getElementById('signup-confirm-password').value = '';
        
        // Switch to sign-in form after short delay
        setTimeout(() => {
          showSignin();
          // Pre-fill email in sign-in form
          document.getElementById('signin-email').value = email;
        }, 2000);
      } else {
        showMessage(data.error || 'Registration failed. Please try again.', 'error');
      }
    } catch (error) {
      console.error('Sign up error:', error);
      showMessage('Network error. Please check your connection.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign Up';
    }
  }
  
  // Event listeners
  showSignupBtn.addEventListener('click', showSignup);
  showSigninBtn.addEventListener('click', showSignin);
  signinForm.addEventListener('submit', handleSignin);
  signupForm.addEventListener('submit', handleSignup);
  
  // Check for existing session on page load
  checkExistingSession();
  
  // Apply saved theme
  const savedTheme = localStorage.getItem('iot_theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light');
  }
})();
