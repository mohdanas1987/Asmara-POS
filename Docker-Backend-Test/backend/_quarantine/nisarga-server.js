require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Model } = require('objection');
const Knex = require('knex');
const path = require('path');
const buildPath = path.join(__dirname, 'client/build');

const knex = Knex({
    client: 'mysql2',
    connection: {
        host:"srv1399.hstgr.io",
        user:"u272122742_nisarga",
        database:"u272122742_nisarga",
        password:"U272122742_nisarga",
        port:3306
    },
    pool: {
        min: 2,
        max: 10
    }
});

Model.knex(knex);

const app = express();
const port = 5101;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(buildPath));
app.use('/images', express.static(path.join(__dirname, 'tmp')));

app.get("/", (r, res) => res.send("Exit"));
app.use("/auth", require("./routes/auth"));
app.use("/customers", require("./routes/customers"));
app.use("/products", require("./routes/products"));
app.use("/orders", require("./routes/orders"));
app.use("/category", require("./routes/category"));
app.use("/tax", require("./routes/tax"));
app.use("/pos", require("./routes/pos"));
app.use("/notes", require("./routes/notes"));
app.use("/config", require("./routes/config"));

app.get('/check-connection', async(req,res) => {
    knex.raw('SELECT 1')
    .then(() => res.json({status:true, message: '✅ Database connected successfully!'}))
    .catch((err) => res.json({status:false, message: '❌ Database connection failed'}))
})

// app.listen(port);

let server
function start(){
    server = app.listen(port)
    server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            console.error(`❌ Port ${port} is already in use.`);
            process.exit(1); // Exit the process
        } else {
            console.error("Server error:", err);
        }
    });
}

function stop(){
  server.close()
}

module.exports = { start, stop }
// module.exports = {knex}