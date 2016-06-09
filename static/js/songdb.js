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

  self.queues = {'default': []}

  self.storeQueues = localforage.createInstance({
    name: self.id + "-queues6"
  })

  self.storeMetadata = localforage.createInstance({
    name: self.id + "-metadata3"
  })

  self.storeData = localforage.createInstance({
    name: self.id + "-data3"
  })
}

var errmsg = function(callback) {
  var f = function(err) {
    console.log('err: %s', err)
    callback(err)
  }
  return f
}

var promise = function(myThis, func) {
  var func2 = function() {
    var called = false
    var args = null
    var callThen = null
    var callCatch = null

    var _firstArg = function(myArgs) {
      var firstArg = null
      if (myArgs.length > 0) {
        firstArg = myArgs[0]
      }
      return firstArg
    }

    var _catch = function(f) {
      if (called) {
        firstArg = _firstArg(args)
        if (firstArg) {
          console.log('_catch!!!')
          f(firstArg)
        }
      } else {
        callCatch = f
      }
    }

    var _then = function(f) {
      console.log('then')
      if (called) {
        firstArg = _firstArg(args)
        if (!firstArg) {
          console.log('apply f _then')
          f.apply(this, args.slice(1))
        }
      } else {
        console.log('then callThen: %o', f)
        callThen = f
      }

      return {'catch': _catch}
    }

    var once = false

    var callback2 = function() {
      if (once) {
        assert(false, "Callback called more than once")
      } else {
        once = true
      }
      called = true
      args = [].slice.call(arguments)
      console.log('callback2 called: %s args %o %o', args.length, callback2, args)

      var firstArg = _firstArg(args)
      if (firstArg) {
        console.log('firstArg true')
        if (callCatch) {
          console.log('callCatch')
          callCatch(firstArg)
        }
      } else {
        console.log('firstArg false')
        if (callThen) {
          console.log('callThen')
          callThen.apply(null, args.slice(1))
        }
      }
    }


    var a = [].slice.call(arguments)
    a.push(callback2)
    console.log('a.length: %i', a.length)
    func.apply(myThis, a)

    return {
      'then': _then,
      'catch': _catch,
    }
  }

  return func2
}

SongDB.prototype.Queue = function(queueName) {
  var self = this

  var queueHead = function() {
    return queueName + '-HEAD'
  }

  var queueTail = function() {
    return queueName + '-TAIL'
  }

  var queueHash = function(hash) {
    assert(hash !== null)
    return queueName + '-' + hash
  }

  var getHash = promise(this, function(hash, callback) {
    self.storeQueues.getItem(queueHash(hash)).then(function(links) {
      callback(null, links)
    }).catch(errmsg(callback))
  })

  var _getHashAndLinksForPseudonym = function(hashPseudonym, callback) {
    self.storeQueues.getItem(hashPseudonym).then(function(hash) {
      if (hash) {
        self.storeQueues.getItem(queueHash(hash)).then(function(links) {
          console.log('found hash in _getHashAndLinks: %s %o', hash, links)
          callback(null, hash, links)
        }).catch(errmsg(callback))
      } else {
        console.log('pseudonym found null no pseudonym')
        callback(null, null, [null, null])
      }
    }).catch(function(err) {
      // pseudonym doesnt exist, empty list
      console.log('found null no tail')
      callback(null, null, [null, null])
    })
  }

  var getTail = promise(this, function(callback) {
    _getHashAndLinksForPseudonym(queueTail(), callback)
  })

  var getHead = promise(this, function(callback) {
    _getHashAndLinksForPseudonym(queueHead(), callback)
  })

  var _appendNextCache = function(links, cache, callback) {
    var nextHash = links[1]
    if (nextHash) {
      cache.push(nextHash)
      getHash(nextHash).then(function(nextLinks) {
        _appendNextCache(nextLinks, cache, callback)
      }).catch(errmsg(callback))
    } else {
      callback(null)
    }
  }

  var fillCache = function(cache, callback) {
    console.log('will get head')
    getHead().then(function(headHash, links) {
      assert(links[0] === null)
      if (headHash) {
        console.log('headHash: %s', headHash)
        cache.push(headHash)
        _appendNextCache(links, cache, callback)
      } else {
        console.log('empty list')
        // empty list
        callback(null)
      }
    }).catch(errmsg(callback))
  }

  var setHash = promise(this, function(hash, links, callback) {
    self.storeQueues.setItem(queueHash(hash), links).then(function() {
      callback(null)
    }).catch(errmsg(callback))
  })

  var setHead = promise(this, function(hash, callback) {
    self.storeQueues.setItem(queueHead(), hash).then(function() {
      callback(null)
    }).catch(errmsg(callback))
  })

  var setTail = promise(this, function(hash, callback) {
    self.storeQueues.setItem(queueTail(), hash).then(function() {
      callback(null)
    }).catch(errmsg(callback))
  })

  var length = function() {
    return self.queues[queueName].length
  }

  var isEmpty = function() {
    return length() == 0
  }

  var all = function() {
    return self.queues[queueName]
  }

  var splicePrev = promise(this, function(hash, prevHash, nextHash, callback) {
    // Splice a doubly linked list on prev node
    if (prevHash === null) {
      // this is a head node, set a new head
      setHead(nextHash).then(function(err) {
        callback(err)
      }).catch(errmsg(callback))
    } else {
      getHash(prevHash).then(function(links) {
        setHash(prevHash, [links[0], nextHash]).then(function(err) {
          callback(err)
        }).catch(errmsg(callback))
      }).catch(errmsg(callback))
    }
  })

  var spliceNext = promise(this, function(hash, prevHash, nextHash, callback) {
    // Splice a doubly linked list on next node, assuming prev node already splice
    if (nextHash === null) {
      // this is a tail node, set a new tail
      setTail(prevHash).then(function() {
        callback(null)
      }).catch(errmsg(callback))
    } else {
      getHash(nextHash).then(function(links) {
        setHash(nextHash, [prevHash, links[1]]).then(function() {
          callback()
        }).catch(errmsg(callback))
      }).catch(errmsg(callback))
    }
  })

  var cachedAddToHead = function(hash) {
    self.queues[queueName].unshift(hash)
  }

  var contains = function(hash) {
    return self.queues[queueName].indexOf(hash) >= 0
  }

  var cachedSplice = function(hash) {
    var index = self.queues[queueName].indexOf(hash)
    self.queues[queueName].splice(index, 1)
  }

  return {
    'getHead': getHead,
    'getTail': getTail,
    'getHash': getHash,
    'setHash': setHash,
    'length': length,
    'isEmpty': isEmpty,
    'all': all,
    'contains': contains,

    'setHead': setHead,
    'setTail': setTail,
    'fillCache': fillCache,

    'splicePrev': splicePrev,
    'spliceNext': spliceNext,

    'cachedAddToHead': cachedAddToHead,
    'cachedSplice': cachedSplice,
  }
}

SongDB.prototype.addToHeadOfQueue = function(queueName, hash, callback) {
  var self = this
  var queue = self.Queue(queueName)
  assert(queueName === "default")

  if (queue.contains(hash)) {
    self._debug('queue already contains song (should move to top)')
    self.moveToTopOfQueue(queueName, hash, function(err) {
      self._debug('Move complete')
      callback(err)
    })
  } else {
    if (queue.isEmpty()) {
      queue.setHash(hash, [null, null]).then(function() {
        queue.setHead(hash).then(function() {
          queue.setTail(hash).then(function() {
            queue.cachedAddToHead(hash)
            callback(null)
          }).catch(errmsg(callback))
        }).catch(errmsg(callback))
      }).catch(errmsg(callback))
    } else {
      queue.getHead().then(function(headHash, links) {
        var prevHeadHash = links[0]
        assert(prevHeadHash === null)
        assert(headHash !== null)
        queue.setHash(hash, [null, headHash]).then(function() {
          queue.setHash(headHash, [hash, links[1]]).then(function() {
            queue.setHead(hash).then(function() {
              queue.cachedAddToHead(hash)
              s = []
              queue.fillCache(s, function(err) {
                console.log('s: %o', s)
                console.log('q: %o', self.queues[queueName])
                assert(s.length === self.queues[queueName].length)
                for(var i=0; i<s.length; s++) {
                  assert(s[i] === self.queues[queueName][i])
                }
                callback(null)
              })
            }).catch(errmsg(callback))
          }).catch(errmsg(callback))
        }).catch(errmsg(callback))
      }).catch(errmsg(callback))
    }
  }
}

SongDB.prototype.removeFromQueue = function(queueName, hash, callback) {
  var self = this
  var queue = self.Queue(queueName)
  // TODO: lock the queue operations? queue up the queue operations?

  var startingLength = queue.length()
  assert(queue.length() > 0)
  assert(queue.contains(hash))

  queue.getHash(hash).then(function(links) {
    var prevHash = links[0]
    var nextHash = links[1]
  
    queue.splicePrev(hash, prevHash, nextHash).then(function(err) {
      if (err) {
        callback(err)
      } else {
        queue.spliceNext(hash, prevHash, nextHash).then(function(err) {
          if (err) {
            callback(err)
          } else {
            queue.cachedSplice(hash)
            assert(queue.length() === (startingLength - 1))
            callback(null)
          }
        }).catch(errmsg(callback))
      }
    }).catch(errmsg(callback))
  }).catch(errmsg(callback))
}

SongDB.prototype.appendToBottomOfQueue = function(queueName, hash, callback) {
  var self = this
  var queue = self.Queue(queueName)
  // TODO: lock the queue operations? queue up the queue operations?

  if(queue.length() > 0) {
    assert(!queue.contains(hash))
    queue.getTail().then(function(tailHash, tailLinks) {
      queue.setHash(hash, [tailHash, null]).then(function() {
        queue.setHash(tailHash, [tailLinks[0], hash]).then(function() {
          queue.setTail(hash).then(function() {
            self.queues[queueName].push(hash)
            callback(null)
          }).catch(errmsg(callback))
        }).catch(errmsg(callback))
      }).catch(errmsg(callback))
    }).catch(errmsg(callback))
  } else {
    self.addToHeadOfQueue(queueName, hash, callback)
  }
}

SongDB.prototype.moveTopToBottomOfQueue = function(queueName, callback) {
  var self = this
  var queue = self.Queue(queueName)
  // TODO: lock the queue operations? queue up the queue operations?

  assert(queue.length() > 0)
  queue.getHead().then(function(headHash, headLinks) {
    assert(headLinks[0] === null)
    self.removeFromQueue(queueName, headHash, function(err) {
      if(err) {
        callback(err)
      } else {
        self.appendToBottomOfQueue(queueName, headHash, callback)
      }
    })
  })
}

SongDB.prototype.moveToTopOfQueue = function(queueName, hash, callback) {
  var self = this
  var queue = self.Queue(queueName)
  // TODO: lock the queue operations? queue up the queue operations?

  assert(queue.length() > 0)
  assert(queue.contains(hash))
  self.removeFromQueue(queueName, hash, function(err) {
    if(err) {
      callback(err)
    } else {
      self.addToHeadOfQueue(queueName, hash, callback)
    }
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
      self._debug('Will fill all queues')
      // TODO: fill all queues
      var queueName = 'default'
      var queue = self.Queue(queueName)
      self.queues[queueName] = []
      queue.fillCache(self.queues['default'], function(err) {
        if (err) {
          callback(err)
        } else {
          self._debug("Finished starting iteration of songdb")
          var tail = null
          if (queue.length() > 0) {
            tail = self.queues[queueName][queue.length() - 1]
          }
          queue.setTail(tail, function(err) {
            if (err) {
              self._debug("Could not set tail")
            } else {
              callback(null, self)
            }
          })
        }
      })
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
        metadata.hash = hash
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
                  metadata.hash = hash
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

SongDB.prototype.findSongMetadata = function(hash, callback) {
  var self = this
  self.findSongsMetadata([hash], function(err, metadatas) {
    var metadata = null
    if (metadatas) {
      metadata = metadatas[0]
      metadata.hash = hash
    }
    callback(err, metadata)
  })
}

SongDB.prototype.findSongMetadataNotID3 = function(hash, callback) {
  var self = this
  self.findSongMetadata(hash, function(err, metadata) {
    if (metadata) {
      delete metadata.id3
    }
    callback(err, metadata)
  })
}

SongDB.prototype.queue = function(queueName, callback) {
  var self = this
  assert(queueName === "default")

  var queue = self.Queue(queueName)
  self.findSongsMetadata(queue.all(), function(err, metadatas) {
    callback(err, metadatas)
  })
}

