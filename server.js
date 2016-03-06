var express = require('express');
var view = require('./src/view');
var storage = require('./src/storage');
var md5 = require('md5');
var LRU = require("lru-cache");
var bodyParser = require('body-parser');
var jade = require('jade');

var app = express();

app.use(bodyParser.urlencoded({ extended: true }));
var MODELS = {};
var CACHE = new LRU({
  max: 50,
  dispose: key => {
    log("disposing", key, "from cache");
    var model = MODELS[key];
    model && model.save();
    delete MODELS[key];
  }
});

var getTimeStamp = () => {
  var timestamp = new Date().getTime();
  timestamp = Math.floor(timestamp / 10000000);
  return (timestamp).toString(16)
}
app.set('views', __dirname + '/views')
app.set('view engine', 'jade');
app.use(express.static(__dirname + '/resources/public'));

var log = function () {
  var date = new Date();
  var timestamp = date.getDate() + "/" + date.getMonth() + " " + date.getHours() + ":" + 
    date.getMinutes() + ":" + date.getSeconds() + "." + date.getMilliseconds();
  var message = Array.prototype.slice.call(arguments);
  message.unshift("--");
  message.unshift(timestamp);
  console.log.apply(console, message);
} 

app.get('/', function (req, res) {
  res.render('index',
  { title : 'PASTE' }
  )
})

app.get('/new', function (req, res) {
  log(req.ip, "opens /new");
  res.send(view.newNotePage(getTimeStamp() + md5(Math.random())));
});

app.post('/note', function (req, res) {
  var body = req.body,
    session = body.session,
    note = body.note,
    password = body.password,
    action = body.action,
    id = body.id;
  log(req.ip, "calls /note to", action, id);
  var goToNote = note => res.redirect("/" + note.id);
  if (session.indexOf(getTimeStamp()) != 0)
    return sendResponse(res, 400, "Session expired");
  var expectedSignature = md5(session + note.replace(/[\n\r]/g, ""));
  if (expectedSignature != body.signature)
    return sendResponse(res, 400, "Signature mismatch");
  if (action == "POST")
    storage.addNote(note, password).then(goToNote);
  else {
    CACHE.del(id);
    storage.updateNote(id, password, note).then(goToNote, 
      error => sendResponse(res, 403, error.message));
  }
});

app.get("/:year/:month/:day/:title", function (req, res) {
  var P = req.params, url = P.year + "/" + P.month + "/" + P.day + "/" + P.title;
  log(req.ip, "resolves deprecated id", url);
  if (CACHE.has(url)) {
    log(url, "is cached!");
    var id = CACHE.get(url);
    if (id) res.redirect("/" + id);
    else notFound(res);
  } else storage.getNoteId(url).then(note => {
    log(url, "is not cached, resolving...");
    if (note) {
      CACHE.set(url, note.id);
      res.redirect("/" + note.id)
    } else {
      CACHE.set(url, null);
      notFound(res);
    }
  });
});

app.get(/\/([a-z0-9]+\/edit)/, function (req, res) {
  var link = req.params["0"].replace("/edit", "");
  log(req.ip, "calls /edit on", link);
  storage.getNote(link).then(note => res.send(note
    ? view.editNotePage(getTimeStamp() + md5(Math.random()), note)
    : notFound(res)));
});

app.get(/\/([a-z0-9]+\/export)/, function (req, res) {
  var link = req.params["0"].replace("/export", "");
  log(req.ip, "calls /export on", link);
  res.set({ 'Content-Type': 'text/plain', 'Charset': 'utf-8' });
  storage.getNote(link).then(note => note
    ? res.send(note.text)
    : notFound(res));
});

app.get(/\/([a-z0-9]+\/stats)/, function (req, res) {
  var link = req.params["0"].replace("/stats", "");
  log(req.ip, "calls /stats on", link);
  var promise = link in MODELS
    ? new Promise(resolve => resolve(MODELS[link]))
    : storage.getNote(link);
  promise.then(note => note
    ? res.send(view.renderStats(note))
    : notFound(res));
});

app.get(/\/([a-z0-9]+)/, function (req, res) {
  var link = req.params["0"];
  log(req.ip, "open note", link, "from", req.get("Referer"));
  if (CACHE.has(link)) {
    log(link, "is cached!");
    var note = MODELS[link];
    if (!note) return notFound(res);
    note.views++;
    res.send(CACHE.get(link));
  } else storage.getNote(link).then(note => {
    log(link, "is not cached, resolving...");
    if (!note) {
      CACHE.set(link, null);
      return notFound(res);
    }
    var content = view.renderNote(note);
    CACHE.set(link, content);
    MODELS[link] = note;
    note.views++;
    res.send(content);
  });
});

var sendResponse = (res, code, message) => {
  log("sending response", code, message);
  res.status(code).send(view.renderPage(message, "<h1>" + message + "</h1>", ""));
}

var notFound = res => sendResponse(res, 404, "Not found");

var server = app.listen(process.env.PORT, process.env.IP);

setInterval(() => {
  var keys = Object.keys(MODELS);
  log("saving stats for", keys.length, "models...");
  keys.forEach(id => MODELS[id].save())
}, 60 * 5 * 1000);
