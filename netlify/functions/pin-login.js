import { createClient } from '@supabase/supabase-js';
import { authenticator } from 'otplib'; 
import { signToken } from './_auth.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // 🛟 MOVED INSIDE THE TRY/CATCH AND USING YOUR EXACT ENV VARS
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing Supabase credentials");
      return { statusCode: 500, body: JSON.stringify({ error: "Server config error: Missing Database Keys" }) };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { pin, totpCode } = JSON.parse(event.body);
    const clientIp = event.headers['x-forwarded-for']?.split(',')[0] || event.headers['client-ip'] || '127.0.0.1';


    // 1. Admin PIN (env var)
    if (pin === process.env.ADMIN_PIN) {
      const token = signToken({ role: 'admin', status: 'active' });
      return { statusCode: 200, body: JSON.stringify({ token, role: 'admin' }) };
    }

    // 2. Manager/Staff PINs (Supabase)
    // Query staff_directory for matching PIN
    const { data: staff, error: staffError } = await supabase
      .from('staff_directory')
      .select('id, name, email, role, is_active, pin')
      .eq('pin', pin)
      .eq('is_active', true)
      .single();

    if (staffError || !staff) {
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid PIN." }) };
    }

    // Only allow manager/barista roles
    if (staff.role !== 'manager' && staff.role !== 'barista') {
      return { statusCode: 403, body: JSON.stringify({ error: "Unauthorized role." }) };
    }

    // 3. Network Verification for Baristas & Managers
    const { data: settings, error: dbError } = await supabase
      .from('store_settings')
      .select('shop_ip_address')
      .limit(1)
      .single();

    if (dbError || !settings) {
      return { statusCode: 500, body: JSON.stringify({ error: "Database configuration error." }) };
    }

    const isNetworkValid = (clientIp === settings.shop_ip_address || clientIp === '127.0.0.1' || clientIp === '::1');

    if (!isNetworkValid) {
      if (staff.role === 'barista') {
        return { 
          statusCode: 403, 
          body: JSON.stringify({ error: "NETWORK_BLOCKED", message: "Off-site access denied. Please connect to the BrewHub Wi-Fi." }) 
        };
      }

      if (staff.role === 'manager') {
        if (!totpCode) {
          return { 
            statusCode: 403, 
            body: JSON.stringify({ error: "TOTP_REQUIRED", message: "Unrecognized network. Enter Manager Authenticator code." }) 
          };
        }

        const isValidTotp = authenticator.verify({
          token: totpCode,
          secret: process.env.MANAGER_TOTP_SECRET
        });

        if (!isValidTotp) {
          return { statusCode: 401, body: JSON.stringify({ error: "INVALID_TOTP", message: "Invalid authenticator code." }) };
        }
      }
    }

    // 4. Issue Token with staff info
    const token = signToken({
      role: staff.role,
      staffId: staff.id,
      name: staff.name,
      email: staff.email,
      status: 'active',
      pin: staff.pin
    });
    return { statusCode: 200, body: JSON.stringify({ token, role: staff.role, staff }) };

  } catch (error) {
    console.error('PIN Login Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal Server Error" }) };
  }
};