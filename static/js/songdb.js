function merge_options(obj1, obj2){
    var obj3 = {}
    for (var attrname in obj1) { obj3[attrname] = obj1[attrname] }
    for (var attrname in obj2) { obj3[attrname] = obj2[attrname] }
    return obj3
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

var migrations = [function(db, i, key, data, targetVersion, callback) {
  if (data._version && data._version >= targetVersion) {
    // up to date
    //console.log("Key %s (%o) already up to date on version %i", key, data, targetVersion)
    callback(i, null, data)
  } else {
    console.log("Upgrading %s to version %i: %o", key, targetVersion, data)
    var newdata = {}
    newdata.id3 = data
    newdata.duration = data.duration
    newdata.temporary = false
    newdata._version = targetVersion
    console.log("Upgraded %s to version %i: %o", key, targetVersion, newdata)
    db.setItem(key, newdata, function(err) {
      callback(i, err, newdata)
    })
  }
},
function(db, i, key, data, targetVersion, callback) {
  if (data._version && data._version >= targetVersion) {
    // up to date
    //console.log("Key %s (%o) already up to date on version %i", key, data, targetVersion)
  } else {
    //console.log("Upgraded %s to version %i: %o", key, targetVersion, newdata)
    var newdata = {}
    if (data.id3.id3) {
      newdata.id3 = data.id3.id3
      newdata.duration = data.duration
      console.log("Fixing upgrade %s to version %i: %o", key, targetVersion, newdata)
    } else {
      newdata.id3 = data.id3
      newdata.duration = data.duration
      //console.log("all good: %o %o %o", key, targetVersion, newdata)
    }
    newdata.source = 'local'
    newdata._version = targetVersion
    db.setItem(key, newdata, function(err) {
      callback(i, err, newdata)
    })
  }
}
]

function SongDB(opts) {
  var self = this
  if (!(self instanceof SongDB)) return new SongDB(opts)
  self._debug('new SongDB %o', opts)

  if (!opts) opts = {}
  self.id = opts.id || "SongDB"
  self.migrations = migrations

  self.storeMetadata = localforage.createInstance({
    name: self.id + "-metadata2"
  })

  self.storeData = localforage.createInstance({
    name: self.id + "-data2"
  })
}

SongDB.prototype.removeSong = function(hash, callback) {
  var self = this
  self.storedMetadata.removeItem(hash, function(err) {
    if (err) {
      callback(err)
    } else {
      self.storeData.removeItem(hash, function(err) {
        if (err) {
          callback(err)
        } else {
          callback(null, null)
        }
      })
    }
  })
}

var deleteTemporary = function(songdb, i, key, data, callback) {
  if (data.temporary) {
    songdb.removeSong(key, function(err) {
      callback(i, null, null)
    })
  } else {
    callback(i, null, data)
  }
}

SongDB.prototype.ensureUpgraded = function(callback) {
  var self = this
  self.storeMetadata.length().then(function(numberOfKeys) {
    var accumulator = makeAccumulator(numberOfKeys, callback)

    self.storeMetadata.iterate(function(id3, hash, iterationNumber) {
      var migration1 = self.migrations[0]
      var migration2 = self.migrations[1]
      migration1(self.storeMetadata, iterationNumber, hash, id3, 1, function(i, err, value1) {
        migration2(self.storeMetadata, i, hash, value1, 2, function(i, err, value2) {
          deleteTemporary(self, i, hash, value, accumulator)
        })
      })
    }).then(function() {
      callback(null, self)
      self._debug("Finished starting iteration of songdb")
    }).catch(function(err) {
      self._debug("Error in iteration of songdb: %s", err)
      callback(err)
    })
  }).catch(function(err) {
    self._debug("Could not get length of db")
    callback(err)
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

  var started = Date.now()
  self.storeMetadata.iterate(function(metadata, hash, iterationNumber) {
    var tokens = tokenizeID3(metadata.id3)
    if (tokensContainParts(tokens, queryParts)) {
      metadata.hash = hash
      results.push(metadata)
    }
  }).then(function() {
    self._debug('Search completed in %f ms: %o', (Date.now() - started), results)
    callback(null, results)
  }).catch(function(err) {
    self._debug('Error: %o', err)
    callback(err)
  })
}

SongDB.prototype.updateMetadata = function (hash, metadata1, callback) {
  var self = this
  // TODO: race condition
  self.storeMetadata.getItem(hash).then(function(metadata2) {
    var final = merge_options(metadata1, metadata2)
    self.storeMetadata.setItem(hash, final).then(function() {
      if (callback) callback(null)
    }).catch(function(err) {
      if (callback) callback(err)
    })
  }).catch(function(err) {
    if (callback) callback(err)
  })
}

SongDB.prototype.currentVersion = function () {
  var self = this
  return self.migrations.length
}

SongDB.prototype.addSong = function (data, extraMetadata, callback) {
  var self = this
  console.log('data: %s %s', data.size, data.type)
  blobToDataURI(data, function(dataURI) {
    console.log('data uri: (%i) %s %s', dataURI.length, dataURI.slice(0, 100), dataURI.slice(dataURI.length - 100))
    var hash = Sha256.hash(dataURI)

    var check = self.storeMetadata.getItem(hash, function(err, metadata) {
      if (metadata) {
        self._debug('Existing Song: Song already in DB: %s %o', hash, metadata)
        callback(null, metadata)
      } else {
        self._debug('New Song: Will add song %s: %s', hash, err)
        jsmediatags.read(data, {
          onSuccess: function(id3) {
            self._debug('Parsed id3 for song %s: %o %o', hash, id3.tags.title, id3)
            // Also get the duration using HTML5
            getBlobAudioDuration(data, function(duration) {
              // And set duration in ID3 dictionary
              var metadata = merge_options(extraMetadata,
                            {'id3': id3,
                             'duration': duration,
                             'source': 'local',
                             'type': data.type,
                             'size': data.size,
                             '_version': self.currentVersion()
              })
              self._debug('Got duration for song %s: %o %o', hash, metadata.id3.tags.title, metadata.duration)
              var d = self.storeData.setItem(hash, data)
              d.then(function() {
                self._debug('Stored data url for song %s: %o %o', hash, metadata.id3.tags.title, id3)
                var i = self.storeMetadata.setItem(hash, metadata)
                i.then(function() {
                  self._debug('Stored metadata for song %s: %o %o', hash, metadata.id3.tags.title, metadata)
                  callback(null, metadata)
                })
                i.catch(function(err) {
                  self._debug('Failed to store metadata for song %s: %o %o', hash, metadata.id3.tags.title, metadata)
                  callback(err)
                })
              })
              d.catch(function(err) {
                self._debug('Failed to store data url for song %s: %o %o', hash, metadata.id3.tags.title, metadata)
                callback(err)
              })
            })
          },
          onError: function(err) {
            self._debug('Failed to parse id3 for song %o: %o', hash, data)
            callback(err)
          }
        })
      }
    })
  })
}

SongDB.prototype.findSongData = function (hash, callback) {
  var self = this
  self.storeData.getItem(hash).then(function(data) {
    callback(null, data)
  }).catch(function(err) {
    callback(err)
  })
}

SongDB.prototype.findSongsMetadata = function(hashes, callback) {
  var self = this
  
  var accumulator = makeAccumulator(hashes.length, callback)

  hashes.forEach(function(hash, i) {
    self.storeMetadata.getItem(hash, function(err, metadata) {
      self._debug('metadata for item %i: %o (err %o)', i, metadata, err)
      metadata.hash = hash
      accumulator(i, err, metadata)
    })
  })
}

SongDB.prototype.findSongMetadataNotID3 = function(hash, callback) {
  var self = this
  self.findSongsMetadata([hash], function(err, metadatas) {
    var metadata = null
    if (metadatas) {
      metadata = metadatas[0]
      delete metadata.id3
    }
    callback(err, metadata)
  })
}

SongDB.prototype.queue = function(queueName, callback) {
  var self = this
  assert(queueName === "default")
  // TODO make real queue (stored in localStorage)
  self.storeMetadata.keys().then(function(keys) {
    self.findSongsMetadata(keys, function(err, metadatas) {
      callback(err, metadatas)
    })
  }).catch(function(err) {
    self._debug('Error retrieving queue: %o', err)
    callback(err)
  })
}

