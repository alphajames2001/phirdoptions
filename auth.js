// auth.js
const db = require('./database')
const { supabaseAuth } = require('./middleware')

// Signup webhook, called by a Supabase database webhook on auth.users
// insert.
//
// The database trigger (see database.sql) already creates the
// profiles row, both accounts, the KYC submission and the role row, so
// this endpoint is a second path to the same state rather than the only
// path. It has to be idempotent for that reason: a plain insert runs
// into UNIQUE(user_id, type) / UNIQUE(user_id) against the rows the
// trigger just wrote, which turned this endpoint into a 500 on every
// signup.
async function onSignup(req, res) {
  const secret = req.headers['x-supabase-webhook-secret']
  if (!process.env.SUPABASE_WEBHOOK_SECRET || secret !== process.env.SUPABASE_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { record } = req.body
  const userId = record?.id
  if (!userId) {
    return res.status(400).json({ error: 'Missing record.id' })
  }

  try {
    await db.ensureUserAccounts(userId)

    await db.supabase
      .from('kyc_submissions')
      .upsert({ user_id: userId, status: 'pending' }, { onConflict: 'user_id', ignoreDuplicates: true })

    await db.supabase
      .from('user_roles')
      .upsert({ user_id: userId, role: 'user' }, { onConflict: 'user_id', ignoreDuplicates: true })

    // Promote allowlisted admin emails - but only once the address has
    // been confirmed, so a signup with an unverified allowlisted
    // address can't claim the admin role.
    if (await db.isEmailConfirmed(userId, record)) {
      await db.promoteAdminIfAllowlisted(userId, record.email)
    }

    res.status(200).json({ success: true })
  } catch (err) {
    console.error('Failed to create accounts for user', userId, err)
    res.status(500).json({ error: 'Account setup failed' })
  }
}

async function getMe(req, res, next) {
  try {
    const [accounts, kycSub, role] = await Promise.all([
      db.getAccountsByUserId(req.user.id),
      db.supabase.from('kyc_submissions').select('*').eq('user_id', req.user.id).single(),
      db.supabase.from('user_roles').select('role').eq('user_id', req.user.id).single(),
    ])

    const kycStatus = kycSub.data?.status || 'none'
    
    // Get display name from user metadata using the user's own token
    let displayName = req.user.email?.split('@')[0] || 'User'
    try {
      const { data: userData, error: userError } = await supabaseAuth.auth.getUser(req.token)
      if (!userError && userData?.user?.user_metadata?.display_name) {
        displayName = userData.user.user_metadata.display_name
      }
    } catch (err) {
      console.warn('[getMe] Could not fetch user metadata:', err.message)
    }

    res.json({
      success: true,
      data: {
        user: {
          id: req.user.id,
          email: req.user.email,
          displayName: displayName,
        },
        accounts,
        kycStatus,
        role: role.data?.role || 'user',
      },
    })
  } catch (err) { next(err) }
}

async function updateProfile(req, res, next) {
  try {
    const { name } = req.body
    
    // Update user metadata using admin API.
    //
    // This has to go through the service-role client (db.supabase).
    // supabaseAuth is built with the anon key, and the admin API
    // requires a service-role key - calling it with the anon key
    // returned 401 every time, so the display name never persisted.
    const { data, error } = await db.supabase.auth.admin.updateUserById(
      req.user.id,
      {
        user_metadata: { display_name: name },
      }
    )
    
    if (error) throw error
    
    // Return the updated user data with display name
    res.json({ 
      success: true, 
      data: { 
        message: 'Profile updated.',
        user: {
          id: req.user.id,
          email: req.user.email,
          displayName: data.user.user_metadata?.display_name || name,
        }
      } 
    })
  } catch (err) { 
    console.error('[Profile Update] Error:', err)
    next(err) 
  }
}

async function getKycStatus(userId) {
  const { data } = await db.supabase
    .from('kyc_submissions')
    .select('status')
    .eq('user_id', userId)
    .single()
  return data?.status || 'none'
}

// Get user profile with display name - simpler approach with fallback
async function getProfile(req, res, next) {
  try {
    // Try to get the user data from the authenticated client
    let displayName = req.user.email?.split('@')[0] || 'User'
    
    try {
      // Attempt to get the full user data with metadata
      const { data, error } = await supabaseAuth.auth.getUser(req.token)
      if (!error && data?.user?.user_metadata?.display_name) {
        displayName = data.user.user_metadata.display_name
      }
    } catch (err) {
      // If this fails, just use the email-based name
      console.warn('[getProfile] Could not fetch user metadata, using email fallback:', err.message)
    }
    
    res.json({
      success: true,
      data: {
        id: req.user.id,
        email: req.user.email,
        displayName: displayName,
      }
    })
  } catch (err) {
    console.error('[getProfile] Error:', err)
    // Always return a success response with fallback data
    res.json({
      success: true,
      data: {
        id: req.user.id,
        email: req.user.email,
        displayName: req.user.email?.split('@')[0] || 'User',
      }
    })
  }
}

module.exports = { 
  onSignup, 
  getMe, 
  updateProfile, 
  getKycStatus,
  getProfile
}