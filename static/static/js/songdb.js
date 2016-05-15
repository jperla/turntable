function dataURItoBlob(dataURI) {
  // convert base64/URLEncoded data component to raw binary data held in a string
  var byteString;
  if (dataURI.split(',')[0].indexOf('base64') >= 0)
      byteString = atob(dataURI.split(',')[1]);
  else
      byteString = unescape(dataURI.split(',')[1]);

  // separate out the mime component
  var mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

  // write the bytes of the string to a typed array
  var ia = new Uint8Array(byteString.length);
  for (var i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
  }

  return new Blob([ia], {type:mimeString});
}

function SongDB(opts) {
  var self = this
  if (!(self instanceof SongDB)) return new SongDB(opts)
  self._debug('new SongDB %o', opts)

  if (!opts) opts = {}
  self.id = opts.id || "SongDB"

  self.storeID3 = localforage.createInstance({
      name: self.id + "-id3"
  })

  self.storeDataURL = localforage.createInstance({
      name: self.id + "-dataURL"
  })
}

SongDB.prototype._debug = function () {
  var self = this
  var args = [].slice.call(arguments)
  args[0] = '[' + self.id + '] ' + args[0]
  console.debug.apply(console, args)
}

var tokenizeID3 = function(id3) {
  // TODO: take out punctuation
  var t = id3.tags
  var s = t.album + ' ' + t.artist + ' ' + t.title + ' ' + t.year
  return s.toLowerCase().split(' ')
}

var parseQuery = function(query) {
  var parts = query.toLowerCase().split(' ')
  return parts
}

var tokensContainSubPart = function(tokens, part) {
  for(var t=0; t<tokens.length; t++) {
    if(tokens[t].indexOf(part) != -1) {
      return true
    }
  }
  return false
}

var tokensContainPart = function(tokens, part) {
  for(var t=0; t<tokens.length; t++) {
    if(tokens[t] === part) {
      return true
    }
  }
  return false
}

var tokensContainParts = function(tokens, parts) {
  if (parts.length === 0) {
    return false
  }

  // TODO: optimize
  for(var p=0; p<(parts.length-1); p++) {
    if (!tokensContainPart(tokens, parts[p])) {
      return false
    }
  }

  var lastPart = parts[parts.length - 1]
  if (tokensContainSubPart(tokens, lastPart)) {
    return true
  } else {
    return false
  }
}

SongDB.prototype.search = function (query, callback) {
  var self = this
  var results = []
  var queryParts = parseQuery(query)

  self.storeID3.iterate(function(id3, hash, iterationNumber) {
    var tokens = tokenizeID3(id3)
    if (tokensContainParts(tokens, queryParts)) {
      var metadata = self._makeMetadata(hash, id3)
      results.push(metadata)
    }
  }).then(function() {
    self._debug('Search completed: %o', results)
    callback(null, results)
  }).catch(function(err) {
    self._debug('Error: %o', err)
    callback(err)
  })
}

SongDB.prototype.addSong = function (dataURL, callback) {
  var self = this
  var hash = Sha256.hash(dataURL)

  var check = self.storeID3.getItem(hash, function(err, id3) {
    if (id3) {
      self._debug('Existing Song: Song already in DB: %s %o', hash, id3)
      callback(null, self._makeMetadata(hash, id3))
    } else {
      self._debug('New Song: Will add song %s: %s', hash, err)
      jsmediatags.read(dataURItoBlob(dataURL), {
        onSuccess: function(id3) {
          // Also get the duration using HTML5
          var a = document.createElement('audio')
          a.src = dataURL
          a.addEventListener('loadedmetadata', function() {
            // And set duration in ID3 dictionary
            id3.duration = a.duration
            var d = self.storeDataURL.setItem(hash, dataURL)
            self._debug('Parsed id3 for song %s: %o %o', hash, id3.tags.title, id3)
            d.then(function() {
              self._debug('Stored data url for song %s: %o %o', hash, id3.tags.title, id3)
              var i = self.storeID3.setItem(hash, id3)
              i.then(function() {
                self._debug('Stored id3 for song %s: %o %o', hash, id3.tags.title, id3)
                callback(null, self._makeMetadata(hash, id3))
              })
              i.catch(function(err) {
                self._debug('Failed to store id3 for song %s: %o %o', hash, id3.tags.title, id3)
                callback(err)
              })
            })
            d.catch(function(err) {
              self._debug('Failed to store data url for song %s: %o %o', hash, id3.tags.title, id3)
              callback(err)
            })
          })
        },
        onError: function(err) {
          self._debug('Failed to parse id3 for song %o: %o', hash, dataURL)
          callback(err)
        }
      })
    }
  })
}

SongDB.prototype.findSongDataURL = function (hash, callback) {
  var self = this
  self.storeDataURL.getItem(hash).then(function(dataURL) {
    callback(null, dataURL)
  }).catch(function(err) {
    callback(err)
  })
}

var makeAccumulator = function(size, callback) {
  var a = 0
  var output = new Array(size)
  var accumulator = function(i, err, value) {
    // ASSUME i never repeats
    if (err) {
      console.log.output('Err accumulating value %i: %o', i, err)
      output[i] = null
    } else {
      output[i] = value
    }
    a += 1
    if (a === size) {
      callback(null, output)
    }
  }
  return accumulator
}

SongDB.prototype._makeMetadata = function(hash, id3) {
  var metadata = {'hash': hash, 'id3': id3}
  return metadata
}

SongDB.prototype.findSongsMetadata = function(hashes, callback) {
  var self = this
  
  var accumulator = makeAccumulator(hashes.length, callback)

  hashes.forEach(function(hash, i) {
    self.storeID3.getItem(hash, function(err, id3) {
      self._debug('metadata for item %i: %o (err %o)', i, id3, err)
      var metadata = self._makeMetadata(hash, id3)
      accumulator(i, err, metadata)
    })
  })
}

SongDB.prototype.queue = function(queueName, callback) {
  var self = this
  assert(queueName === "default")
  // TODO make real queue (stored in localStorage)
  self.storeID3.keys().then(function(keys) {
    self.findSongsMetadata(keys, function(err, metadatas) {
      callback(err, metadatas)
    })
  }).catch(function(err) {
    self._debug('Error retrieving queue: %o', err)
  })
}

SongDB.prototype.search = function (query, callback) {
  var self = this
  // TODO build search index
  // for now, just get first song always
  self.storeID3.key(0).then(function(hash) {
    self.storeID3.getItem(hash).then(function(id3) {
      var metadata = self._makeMetadata(hash, id3)
      callback(null, [metadata])
    }).catch(function(err) {
      callback(err)
    })
  }).catch(function(err) {
    callback(err)
  })
}
