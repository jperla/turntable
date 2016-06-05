function assert(condition, message) {
    if (!condition) {
        message = message || "Assertion failed"
        if (typeof Error !== "undefined") {
            throw new Error(message)
        }
        throw message // Fallback
    }
}

function merge_options(obj1, obj2){
    var obj3 = {}
    for (var attrname in obj1) { obj3[attrname] = obj1[attrname] }
    for (var attrname in obj2) { obj3[attrname] = obj2[attrname] }
    return obj3
}


function getLocalIP(callback) {
    window.RTCPeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;   //compatibility for firefox and chrome
    var pc = new RTCPeerConnection({iceServers:[]}), noop = function(){};      
    pc.createDataChannel("");    //create a bogus data channel
    pc.createOffer(pc.setLocalDescription.bind(pc), noop);    // create offer and set local description
    pc.onicecandidate = function(ice){  //listen for candidate events
        if(!ice || !ice.candidate || !ice.candidate.candidate)  return;
        var myIP = /([0-9]{1,3}(\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(:[a-f0-9]{1,4}){7})/.exec(ice.candidate.candidate)[1];
        callback(myIP);
        pc.onicecandidate = noop;
    };
}

/**********************************/
/*      Emit Handlers             */
/**********************************/

var emit_handler = function(self, eventName, data) {
  if (eventName in self.events) {
    self.events[eventName](data)
  } else {
    if (!(eventName in self.stashedEvents)) {
      self.stashedEvents[eventName] = []
    }
    self.stashedEvents[eventName].push(data)
  }
}

var on_handler = function(self, eventName, f) {
  assert(!(eventName in self.events)) // no overrides
  self.events[eventName] = f

  if (eventName in self.stashedEvents) {
    setTimeout(function() {
      for(var i=0; i<self.stashedEvents[eventName].length; i++) {
        self.emit(eventName, self.stashedEvents[eventName][i])
      }
      delete self.stashedEvents[eventName]
    }, 10)
  }
}

/**********************************/
/*      SimplePeer extensions     */
/**********************************/

SimplePeer.prototype.encodeJSON = function(message) {
  return JSON.stringify(message)
}

SimplePeer.prototype.sendJSON = function(message) {
  var self = this
  var jsonMessage = self.encodeJSON(message)
  self._debug('sendJSON (%i): %o', jsonMessage.length, message)
  self.send(jsonMessage)
}

SimplePeer.prototype.parseJSON = function(rawData) {
  var self = this
  return JSON.parse(rawData)
}

/**********************************/
/*            MeshNode            */
/**********************************/

function MeshNode(peerFactory, opts) {
  var self = this;
  if (!(self instanceof MeshNode)) return new MeshNode(peerFactory, opts)
  self.name = opts['name'] || 'User'
  self.id = opts['id'] || (self.name.toUpperCase() + makeid(8))

  self._debug('new MeshNode %o', opts)

  if (!opts) opts = {}

  self.peerFactory = peerFactory
  self.peers = []
  self.meshNodeIdToPeer = {}
  self._lastUnconnectedPeer = null
  self.isHost = !!opts.isHost
  self.hostPeer = null
  self.downloadPeers = {}
  self.uploadPeers = {}

  var hexId = base64ToHex(self.id).slice(0, 40)
  console.log('hexId: %s', hexId)
  self.torrenter = new WebTorrent({
    'dht': false,
    'peerId': hexId,
    'tracker': false,
  })

  self.anchorStore = localforage.createInstance({
      name: "anchorStore:" + self.id
  })

  /* Emit handlers */
  self.events = {}
  self.stashedEvents = {}
}

MeshNode.prototype.lastUnconnectedPeer = function() {
  var self = this
  return self._lastUnconnectedPeer
}

MeshNode.prototype.setName = function(name) {
  var self = this
  self.name = name
}

MeshNode.prototype.createPeer = function(isInitiator, opts) {
  var self = this
  self._debug("Making new peer");
  return self.peerFactory.createPeer(isInitiator, opts)
}

MeshNode.prototype.numPeers = function() {
  var self = this
  return self.peers.length
}

MeshNode.prototype.broadcastToMeshThroughHost = function(encodedMessageDictionary) {
  var self = this
  if (self.hostPeer) {
    self.hostPeer.sendJSON({'action':'broadcast', 'message': encodedMessageDictionary})
  }
}

MeshNode.prototype.sendToPeer = function(peer, encodedMessageDictionary) {
  var self = this

  try {
    peer.sendJSON(encodedMessageDictionary)
  } catch(err) {
    self._debug("Message to peer %o failed (%o): %o", peer, err, encodedMessageDictionary)
	}
}

MeshNode.prototype.sendToHost = function(encodedMessageDictionary) {
  var self = this
  self.sendToPeer(self.hostPeer, encodedMessageDictionary)
}

MeshNode.prototype.sendToMeshNodeId = function(nodeId, encodedMessageDictionary) {
  var self = this

  self.sendToPeer(self.meshNodeIdToPeer[nodeId], encodedMessageDictionary)
}

MeshNode.prototype.sendToAllPeers = function(encodedMessageDictionary, exceptPeer) {
  var self = this
  for (var i=0; i<self.peers.length; i++) {
    if (self.peers[i] == exceptPeer) {
      continue
    }

    self.sendToPeer(self.peers[i], encodedMessageDictionary)
	}
}

MeshNode.prototype.broadcastChatMessage = function(message) {
  var self = this
  var encodedMessage = self.encodeChatMessage(message)
  if (self.isHost) {
    self._debug('Host will broadcast message to all peers in mesh: %o', message)
    self.sendToAllPeers(encodedMessage)
  } else {
    self._debug('Guest will broadcast message to all peers in mesh through host: %o', message)
    self.broadcastToMeshThroughHost(encodedMessage)
  }
}

MeshNode.prototype.isNodeHost = function() {
  var self = this
  return self.isHost
}

MeshNode.prototype.informPeer = function(peer, message) {
  var self = this
  self.getAnchorURL(function(err, anchorURL) {
    var wholeMessage = {
      'action': 'inform',
      'message': message,
      'name': self.name,
      'meshNodeId': self.id,
      'anchorURL': anchorURL
    }
    peer.sendJSON(wholeMessage)
    self._debug('Inform sent: %o', wholeMessage)
  })
}

MeshNode.prototype.offerHostConnectionThroughPeer = function(peer, sdp) {
  var self = this
	peer.sendJSON({
    'action': 'offerHostConnection',
    'sdp': sdp,
    'name': self.name,
    'id': self.id
  })
}

MeshNode.prototype.answerHostConnectionThroughPeer = function(peer, sdp) {
  var self = this
	peer.sendJSON({
    'action': 'answerHostConnection',
    'sdp': sdp,
    'id': self.id,
    'name': self.name
  })
}

MeshNode.prototype.encodeChatMessage = function(message) {
  var self = this
  return {'action': 'chat',
          'message': message,
          'id': self.id,
          'name': self.name
  }
}

MeshNode.prototype.sendChatMessageToPeer = function(peer, message) {
  var self = this
	peer.sendJSON(self.encodeChatMessage(message))
}

MeshNode.prototype._debug = function () {
  var self = this
  var args = [].slice.call(arguments)
  args[0] = '[' + self.getShortId() + '] ' + args[0]
  console.debug.apply(console, args)
}

MeshNode.prototype._torrent_debug = function () {
  var self = this
  var args = [].slice.call(arguments)
  args[0] = '[torrent] ' + args[0]
  self._debug.apply(self, args)
}

MeshNode.prototype.emit = function(eventName, data) {
  var self = this
  emit_handler(self, eventName, data)
}

MeshNode.prototype.on = function(eventName, f) {
  var self = this
  on_handler(self, eventName, f)
}

MeshNode.prototype.addUploadPeer = function(p, hash, rawDataBits, signalFunc, callback) {
  var self = this
  assert(p != null)
  self.uploadPeers[hash] = {'peer': p, 'rawDataBits': rawDataBits}

  p.on('error', function (err) { console.log('error', err) })

  p.on('signal', function (sdp) {
    self._debug('SIGNAL upload peer %o', sdp)
    signalFunc(sdp)
  })

  p.on('connect', function () {
    self._debug('CONNECT UPLOAD')
    self.torrenter.seed(new File([rawDataBits], hash), {}, function(torrent) {
      self._debug('Generated torrent: %o', torrent)
      p.sendJSON(torrent.infoHash)

      torrent.addPeer(p)

      torrent.on('upload', function (bytes) {
        //self._torrent_debug('just uploaded: %f', bytes)
        //self._torrent_debug('total uploaded: %f', torrent.uploaded);
        self._torrent_debug('numPeers: %i',  torrent.numPeers)
        //self._torrent_debug('ratio: %f', torrent.ratio)
        //self._torrent_debug('upload speed: %f', torrent.uploadSpeed)
        //self._torrent_debug('progress: %f', torrent.progress)
      })

      torrent.on('wire', function (wire, addr) {
        self._torrent_debug('connected to peer with address ' + addr)
      })
    })
  })

  p.on('close', function () {
    self._torrent_debug('Torrent upload done for %s, cleaning up', hash)
    p.destroy(function() {
      var u = self.uploadPeers[hash]
      self._torrent_debug('CONNECT UPLOAD COMPLETE -- data size: %i', u.rawDataBits.length)
      torrent.destroy(function() {
        delete self.uploadPeers[hash]
        if (callback) {
          callback(null, hash, u.rawDataBits)
        }
      })
    })
  })

  return p
}

MeshNode.prototype.getId = function() {
  var self = this
  return self.id
}

LENSHORTID = 9

MeshNode.prototype.getShortId = function() {
  var self = this
  return self.id.slice(0, LENSHORTID)
}

MeshNode.prototype.peerByMeshNodeId = function(meshNodeId) {
  var self = this
  if (meshNodeId in self.meshNodeIdToPeer) {
    return self.meshNodeIdToPeer[meshNodeId]
  } else {
    return null
  }
}

MeshNode.prototype.signalDownloadPeer = function(hash, sdp) {
  var self = this
  if (hash in self.downloadPeers) {
    self.downloadPeers[hash].peer.signal(sdp)
  } else {
    self._debug('Unknown download peer for hash %o', hash)
  }
}

MeshNode.prototype.addDownloadPeer = function(p, hash, signalFunc, streamCallback, doneCallback) {
  var self = this
  assert(p != null)
  self.downloadPeers[hash] = {'peer': p}
  self.once = false

  p.on('error', function (err) { self._debug('error', err) })

  p.on('signal', function (data) {
    self._debug('SIGNAL download peer %o', data)
    signalFunc(data)
  })

  p.on('connect', function () {
    self._debug('CONNECT DOWNLOAD')
  })

  p.on('data', function (chunk) {
    if(!self.once) {
      self.once = true
      self._torrent_debug('download peer received data: %o', chunk)
      infoHash = p.parseJSON(chunk)
      self._torrent_debug('download peer received id: %o', infoHash)
      var torrent = self.torrenter.add(infoHash, {}, function(t) {
        self._torrent_debug('Downloading torrent: %o', t)
      })

      torrent.addPeer(p)

      var once = false
      torrent.on('download', function (bytes) {
        //self._torrent_debug('just downloaded: ' + bytes)
        //self._torrent_debug('total downloaded: ' + torrent.downloaded)
        //self._torrent_debug('download speed: ' + torrent.downloadSpeed)
        //self._torrent_debug('progress: ' + torrent.progress)

        if (torrent.progress > 0.10 && !once) {
          once = true
          self._torrent_debug('Will start streaming: ' + torrent.progress)
          var readable = torrent.files[0].createReadStream()
          streamCallback(readable)
        }
      })

      torrent.on('wire', function (wire, addr) {
        self._torrent_debug('connected to peer with address ' + addr)
      })

      torrent.on('done', function() {
        self._torrent_debug('torrent finished downloading')
        torrent.files[0].getBuffer(function(err, buffer) {
          if (err) {
            console.log('Error after done: %s', err)
            doneCallback(err)
          } else {
            byteArray = new Uint8Array(buffer)
            self._torrent_debug('Downloaded data for %s (%i bytes)', hash, byteArray.length)
            doneCallback(null, hash, byteArray)
          }
        })
        p.destroy()
      })
    }
  })
  
  p.on('close', function() {
    var d = self.downloadPeers[hash]
    self._debug('CONNECT DOWNLOAD COMPLETE')
    delete self.downloadPeers[hash]
  })

  return p
}

MYANCHOR = 'anchorURL'

MeshNode.prototype.getAnchorURL = function(callback) {
  var self = this
  self.anchorStore.getItem(MYANCHOR, callback)
}

MeshNode.prototype.saveAnchorURL = function(anchorURL) {
  var self = this
  self.anchorStore.setItem(MYANCHOR,
                           anchorURL,
                           function(err) {
                             if (err) {
                               self._debug("[ERROR] Could not save anchor url %o: %s", anchorURL, err)
                             } else {
                               self._debug("Saved anchor url %o", anchorURL)
                             }
  })
}

FOREIGNANCHORS = 'allMyForeignAnchors'

MeshNode.prototype.getForeignAnchors = function(callback) {
  var self = this
  self.anchorStore.getItem(FOREIGNANCHORS, function(err, foreignAnchors) {
    if (err) {
      self._debug("Error retrieving foreign anchors: %s", err)
    }

    if (!foreignAnchors) {
      foreignAnchors = []
    }

    callback(foreignAnchors)
  })
}

MeshNode.prototype.saveForeignAnchor = function(meshNodeId, signalingServer) {
  var self = this
  // TODO: validate anchor format
  var anchor = {'id': meshNodeId, 'signalingServer': signalingServer}
  assert(typeof signalingServer === "string", "signaling server for anchor not a string")
  assert(typeof meshNodeId === "string", "meshNodeId for anchor not a string")
  self.getForeignAnchors(function(foreignAnchors) {
    self._debug('Got existing foreign anchors: %o', foreignAnchors)
    // TODO: possible race condition

    // add if it does not exist
    EXISTS = false
    for(var i=0; i<foreignAnchors.length; i++) {
      if (foreignAnchors[i].id === anchor.id && 
          foreignAnchors[i].signalingServer === anchor.signalingServer) {
        EXISTS = true
        break
      }
    }

    if (EXISTS) {
      self._debug('Foreign anchor already exists: %o', anchor)
    } else {
      foreignAnchors.push(anchor)
      self._debug('Will save foreign anchors: %o', foreignAnchors)
      self.anchorStore.setItem(FOREIGNANCHORS,
                               foreignAnchors,
                               function(err) {
                                 if (err) {
                                   self._debug("[ERROR] Could not add foreign anchor %o to %o: %s",
                                               anchor, foreignAnchors, err)
                                 } else {
                                   self._debug("Saved foreign anchor %o to %o", anchor, foreignAnchors)
                                 }
      })
    }

  })
}


MeshNode.prototype.listenToSignalingServer = function() {
  var self = this
  self.getAnchorURL(function(err, anchorURL) {
    if (err) {
      self._debug("[BYOSS] could not find anchor: %s", err)
    }
   
    if (anchorURL) {
      self._debug('Listening for BYOSS anchor applicants: %s', anchorURL)
      socket = io(anchorURL)
      // TODO: do this after connect
      socket.emit('listen', self.id)

      socket.on('offer', function(offer) {
        self._debug('[BYOSS] Offer received: %o', offer)
        assert(offer.destination === self.id)

        var client = self.addPeer(self.createPeer(false), function(sdp) {
          var answer = {'sdp': sdp,
                        'source': self.id,
                        'destination': offer.source}
          socket.emit('answer', answer)
          self._debug('[BYOSS] Emitted answer: %o', answer)
        })
        client.signal(offer.sdp)
      })
    }
  })
}

MeshNode.prototype.connectThroughAnchor = function(anchor) {
  var self = this
  if (anchor) {
    var destination = anchor.id
    var signalingServer = anchor.signalingServer
    socket = io(signalingServer)
    self._debug('[BYOSS] anchorMeshNodeId: %s signalingServer %o', destination, signalingServer)
    var autoHost = self.addPeer(self.createPeer(true), function(sdp) {
      var offer = {'source': self.id, 
                   'destination': destination,
                   'sdp': sdp}
      socket.emit('offer', offer)
      self._debug('[BYOSS] Emitted offer: %o', offer)
    })

    socket.on('answer', function(answer) {
      self._debug('[BYOSS] Received answer: %o', answer)
      autoHost.signal(answer.sdp)
    })
  }
}

MeshNode.prototype.addPeer = function(p, signalFunc) {
  var self = this
  assert(p != null)

  self._lastUnconnectedPeer = p
  self.peers.push(p)

  p.on('error', function (err) { console.log('error', err) })

  p.on('signal', function (data) {
    self._debug('SIGNAL %o', data)
    signalFunc(data)
  })

  p.on('connect', function () {
    self._debug('CONNECT')
    self.sendChatMessageToPeer(p, 'Connection initiated...')

    /* Now if you are not the host, then tell that to your peer */
    self.informPeer(p, {'type': 'isHost', 'isHost': self.isHost})
  })

  p.on('data', function (rawData) {
    self._debug('received data: %o', rawData)
    var data = p.parseJSON(rawData)
    if (data.action == 'chat') {
      self.emit('chat', data)
    } else if (data.action == 'inform') {
      self._debug('Inform received: %o', data)
      self.meshNodeIdToPeer[data.meshNodeId] = p

      if (data.anchorURL) {
        self._debug('Will save foreign anchor: %o', data.anchorURL)
        self.saveForeignAnchor(data.meshNodeId, data.anchorURL)
      }

      if (data.message.type == 'isHost') {
        if (data.message.isHost) {
          self.hostPeer = p
          self._debug('Host peer: %o', self.hostPeer)
          self._debug('Host peer connected: %o', self.hostPeer.connected)
        } else if(self.isHost) {
          self._debug('I am a host.')
        } else {
          if (self.hostPeer != null) {
            self._debug('I am a guest connected to my host. My new peer is distant.')
          } else {
            // Begin connecting to a host through p
            self._debug('I am a distant guest. My new peer is not a host. Try to find one.')
            self.hostPeer = self.addPeer(self.createPeer(true), function(sdp) {
              self._debug('I am a distant guest. Send offer to host through my peer.')
              self.offerHostConnectionThroughPeer(p, sdp)
            })
          }
        }
      }
    } else if (data.action == 'offerHostConnection') {
      if (self.isHost) {
        self._debug('I am a host. I just got a distant guest offer')
        var guest = self.addPeer(self.createPeer(false), function(sdp) {
          self._debug('I am a host. I just sent a distant guest answer')
          self.answerHostConnectionThroughPeer(p, sdp)
        })
        guest.signal(data.sdp)
      } else {
        self._debug('I am a guest with a host. I will signal a new distant guest to a host: %o', self.hostPeer)
        assert(self.hostPeer != null)
        self.waitingPeer = p
        self.offerHostConnectionThroughPeer(self.hostPeer, data.sdp)
      }
    } else if (data.action == 'answerHostConnection') {
      // ASSUME answer is from singular hostPeer attempt
      // ASSUME that if I have a waitingPeer then it's for her
      if (self.waitingPeer) {
        // it's for my latest new peer
        self._debug('Sending answer back to my new peer friend')
        self.answerHostConnectionThroughPeer(self.waitingPeer, data.sdp)
        self.waitingPeer = null
      } else {
        // it's for me!
        // ASSUME I made a hostpeer object
        self._debug('I got an answer from my distant host!')
        self.hostPeer.signal(data.sdp)
        // will be connected very soon, methinks.
      }
    } else if (data.action == 'broadcast') {
      if (self.isHost) {
        self._debug('Broadcast message received, relaying to all peers in mesh: %o', data.message)
        self.sendToAllPeers(data.message, p)
        p.emit('data', p.encodeJSON(data.message))
      } else {
        self._debug('Broadcast message received by non-host: %o', data)
      }
    } else {
      self._debug('Unknown message type, sending to signal to handle: %o', data)
      self.emit('action', {'peer': p, 'data': data})
    }
	})
  return p
}

/**********************************/
/*       SimplePeer Factory       */
/**********************************/

function SimplePeerFactory() {
  var self = this;
  if (!(self instanceof SimplePeerFactory)) return new SimplePeerFactory()
}

SimplePeerFactory.prototype.createPeer = function(isInitiator, opts) {
  console.info("Making new peer");
  var defaults = {initiator: isInitiator,
                  config: {"iceServers":[{"url":"stun:stun.l.google.com:19302"}]},
                  constraints: { 'optional': [{'DtlsSrtpKeyAgreement': true}] },
                  trickle: false,
                 }
	var p = new SimplePeer(merge_options(defaults, opts))
  return p
}

/**********************************/
/*       MeshNode Testing         */
/**********************************/

var TEST=true

function MockPeer(isInitiator, node) {
  var self = this
  if (!(self instanceof MockPeer)) return new MockPeer()
  self.events = {}
  self.stashedEvents = {}

  self.id = makeid(2)
  self.isInitiator = isInitiator
  self.localNode = node
  self.remotePeer = null
  self.connected = false
  self._debug("made peer: %o", self)
}

MockPeer.prototype.emit = function(eventName, data) {
  var self = this
  //self._debug('emit: %o %o', eventName, data)
  emit_handler(self, eventName, data)
}

MockPeer.prototype.on = function(eventName, f) {
  var self = this
  //self._debug('on: %o', eventName)
  on_handler(self, eventName, f)
}

MockPeer.prototype._debug = function () {
  var self = this
  var args = [].slice.call(arguments)
  args[0] = '[PEER-' + self.id + ' ' + (self.localNode ? self.localNode.id : '') + '] ' + args[0]
  console.debug.apply(console, args)
}

MockPeer.prototype.parseJSON = function(rawData) {
  var self = this
  return rawData // not JSON
}

MockPeer.prototype.send = function(message) {
  var self = this
  self._debug("send message: %o", message)
  assert(self.connected, "Sending to unconnected peer")
  self.remotePeer.receive(message)
}

MockPeer.prototype.encodeJSON = function(message) {
  return message
}

MockPeer.prototype.sendJSON = function(message) {
  var self = this
  self.send(self.encodeJSON(message))
}

MockPeer.prototype.receive = function(message) {
  var self = this
  self._debug("received message: %o", message)
  assert(self.connected, "Receiving message to unconnected peer")
  self.emit('data', message)
}

MockPeer.prototype.signal = function(sdp) {
  var self = this
  self.remotePeer = sdp // SDP offer is remote MockPeer
  if (self.isInitiator) {
    self._debug("received answer, so connect")
    self.connect() // received answer, so connect
  } else {
    // send self back to the initiator
    self._debug("send self back to the initiator")
    self.emit('signal', self);
  }
}

MockPeer.prototype.connect = function() {
  var self = this
  self.connected = true
  self._debug('Set connected value')
  if (self.isInitiator) {
    // Tell the remote peer that connection handshake is over
    self._debug('Initiator set connected value')
    self.remotePeer.connect()
    self._debug('Remote peer connected')
    self.emit('connect')
    self._debug('Emitted connect')
    self.remotePeer.emit('connect')
    self._debug('Emitted remote connect')
  }
}

function MockPeerFactory() {
  var self = this;
  if (!(self instanceof MockPeerFactory)) return new MockPeerFactory()
  var localNode = null
}

MockPeerFactory.prototype.setLocalNode = function(node) {
  var self = this
  self.localNode = node
}

MockPeerFactory.prototype.createPeer = function(isInitiator) {
  var self = this
  console.info("Making new mock peer");
	var p = new MockPeer(isInitiator, self.localNode)

  if (isInitiator) {
    var offer = p
    p.emit('signal', offer)
  }
  return p
}

if (TEST) {
  var hostFactory = MockPeerFactory()
  var host = MeshNode(hostFactory, {'isHost': true, 'name': 'AAA'})
  hostFactory.setLocalNode(host)

  var guestBFactory = MockPeerFactory()
  var guestB = MeshNode(guestBFactory, {'isHost': false, 'name': 'BBB'})
  guestBFactory.setLocalNode(guestB)

  var guestCFactory = MockPeerFactory()
  var guestC = MeshNode(guestCFactory, {'isHost': false, 'name': 'CCC'})
  guestCFactory.setLocalNode(guestC)

  assert(host.numPeers() == 0, 'Host connected before start')
  assert(guestB.numPeers() == 0, 'Guest B connected before start')

  host.addPeer(host.createPeer(true), function(hostOffer) {
    console.log("Generated offer")
    var guestBFirstPeer = null
    guestBFirstPeer = guestB.addPeer(guestB.createPeer(false), function(guestBAnswer) {
      console.log("Answer generated")
      // Guest B received the offer, and sent back reply to the host
      var hostFirstPeer = host.lastUnconnectedPeer()
      hostFirstPeer.signal(guestBAnswer)

      assert(hostFirstPeer.connected, 'Host not connected')
      assert(guestBFirstPeer.connected, 'Guest B not connected')

      assert(host.numPeers() == 1, 'Host not connected')
      assert(guestB.numPeers() == 1, 'Guest B not connected')
      assert(guestC.numPeers() == 0, 'Guest C connected')

      guestB.addPeer(guestB.createPeer(true), function(guestBOffer) {
        var guestCFirstPeer = null
        guestCFirstPeer = guestC.addPeer(guestC.createPeer(false), function(guestCAnswer) {
          var guestBSecondPeer = guestB.lastUnconnectedPeer()
          guestBSecondPeer.signal(guestCAnswer)

          assert(guestBSecondPeer.connected, 'GuestB not connected')
          assert(guestCFirstPeer.connected, 'Guest C not connected')

          setTimeout(function() {
            assert(host.numPeers() == 2, 'Host not connected')
            assert(guestB.numPeers() == 2, 'Guest B not connected')
            assert(guestC.numPeers() == 2, 'Guest C not connected')
            console.log('C connected to A!')
          }, 1000)
        })
        guestCFirstPeer.signal(guestBOffer)
      })
    })
    // send the host's offer to Guest B
    guestBFirstPeer.signal(hostOffer)
  })
}

