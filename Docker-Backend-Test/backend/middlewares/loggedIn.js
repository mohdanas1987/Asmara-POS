const jwt = require('jsonwebtoken');
// STAGE 2 / phase 15: JWT_SECRET was a hardcoded literal ('whateverItWas') here, identical
// to the one in routes/auth.js. It now comes from the environment via config/auth.js.
const { JWT_SECRET } = require('../config/auth');

const loggedIn= (req, res , next)=> {
    try{
        const token = req.header('asmara-token');
        if(!token){
            return res.status(401).send({error: 'Please authenticate using correct token'})
        }
        const data = jwt.verify(token, JWT_SECRET);
        req.body.myID= data.user.id
        req.body.application_id = data.user.appKey
        // Phase 1 / Task #10 (multi-tenant foundation): the JWT now carries the tenant_id
        // resolved at login (see routes/auth.js). Every tenant-scoped route reads
        // req.body.tenant_id from here instead of trusting anything the client sends, since
        // client-supplied tenant ids would let one restaurant read or write another's data
        // just by changing a request body field.
        //
        // Fallback to 1 (the only tenant that existed before this migration) covers tokens
        // issued before this change that don't carry a tenant_id yet -- so already-logged-in
        // sessions don't get logged out by this change.
        req.body.tenant_id = data.user.tenant_id ?? 1;
        // RBAC (project audit 2026-09-15): the token's role lives on req.authRole, NOT
        // req.body.role -- routes like POST /users legitimately use `role` in the request
        // body to mean "the role to assign the new staff member," and overwriting that field
        // silently corrupted those requests (found via a real failing test, not guessed at).
        // req.authRole is a separate property no request body will ever collide with, and a
        // client can never set it themselves since nothing here ever reads it from req.body.
        // Fallback to 'admin' for tokens issued before roles existed, so already-logged-in
        // sessions keep exactly the access they had before this change (Preservation Contract).
        req.authRole = data.user.role ?? 'admin';
        next();

    } catch (err){
        return res.send({error : 'Access denied!'})
    }
}

module.exports = loggedIn;
