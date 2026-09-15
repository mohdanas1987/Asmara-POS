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
        next();

    } catch (err){
        return res.send({error : 'Access denied!'})
    }
}

module.exports = loggedIn;
