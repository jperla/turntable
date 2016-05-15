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
    self.events[eventName](data);
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
  self._debug('sendJSON: %o', message)
  self.send(self.encodeJSON(message))
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
  self.hostPeer.sendJSON({'action':'broadcast', 'message': encodedMessageDictionary})
}

MeshNode.prototype.sendToAllPeers = function(encodedMessageDictionary, exceptPeer) {
  var self = this
  for (var i=0; i<self.peers.length; i++) {
    if (self.peers[i] == exceptPeer) {
      continue
    }

    try {
      self.peers[i].sendJSON(encodedMessageDictionary)
    } catch(err) {
      self._debug("Message to peer %i %o failed (%o): %o", i, self.peers[i], err, encodedMessageDictionary)
    }
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
  self.anchor(function(err, anchor) {
    var signalingServer = (anchor ? anchor.signalingServer : null)
    var wholeMessage = {
      'action': 'inform',
      'message': message,
      'name': self.name,
      'meshNodeId': self.id,
      'anchor': signalingServer
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
  args[0] = '[' + self.id + '] ' + args[0]
  console.debug.apply(console, args)
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
  self.uploadPeers[hash] = {'peer': p, 'rawDataBits': rawDataBits, 'i': 0}
  CHUNK_SIZE=64000

  p.on('error', function (err) { console.log('error', err) })

  p.on('signal', function (sdp) {
    self._debug('SIGNAL upload peer %o', sdp)
    signalFunc(sdp)
  })

  p.on('connect', function () {
    self._debug('CONNECT UPLOAD')
    var u = self.uploadPeers[hash]
    var chunk = u.rawDataBits.slice(0, CHUNK_SIZE)
    self._debug('send chunk %i size %i', u.i, chunk.length)
    p.write(chunk)
  })

  p.on('data', function (ack) {
    self._debug('upload peer received data: %o', ack)

    var u = self.uploadPeers[hash]
    u.i += 1
    if (u.i * CHUNK_SIZE < u.rawDataBits.length) {
      var chunk = u.rawDataBits.slice(u.i * CHUNK_SIZE, (u.i + 1) * CHUNK_SIZE)
      self._debug('send chunk %i size %i', u.i, chunk.length)
      p.write(chunk)
    } else {
      self._debug('destroying upload peer:', hash)
      setTimeout(function() {
        p.destroy(function() {
          self._debug('CONNECT UPLOAD COMPLETE -- data size: %i', u.rawDataBits.length)
          if (callback) {
            callback(p, hash, u.rawDataBits)
          }
          delete self.uploadPeers[hash]
        })
      }, 1000)
    }
  })
  
  return p
}

MeshNode.prototype.getId = function() {
  var self = this
  return self.id
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

MeshNode.prototype.addDownloadPeer = function(p, hash, signalFunc, callback) {
  var self = this
  assert(p != null)
  self.downloadPeers[hash] = {'peer': p, 'chunks': []}

  p.on('error', function (err) { console.log('error', err) })

  p.on('signal', function (data) {
    self._debug('SIGNAL download peer %o', data)
    signalFunc(data)
  })

  p.on('connect', function () {
    self._debug('CONNECT DOWNLOAD')
  })

  p.on('data', function (chunk) {
    self._debug('download peer received data: %o', chunk)
    var chunks = self.downloadPeers[hash].chunks
    chunks.push(chunk)
    p.write('ACK 1 ' + chunks.length)
  })
  
  p.on('close', function() {
    var d = self.downloadPeers[hash]
    self._debug('CONNECT DOWNLOAD COMPLETE: %i chunks', d.chunks.length)
    var data = d.chunks.join('')
    callback(p, hash, data)
    delete self.downloadPeers[hash]
  })
  return p
}

MeshNode.prototype.anchor = function(callback) {
  var self = this
  self.anchorStore.getItem('anchor', callback)
}

MeshNode.prototype.saveAnchor = function(meshNodeId, anchorSignalingServerURL) {
  var self = this
  var anchor = {'id': meshNodeId, 'signalingServer': anchorSignalingServerURL}
  self.anchorStore.setItem('anchor',
                           anchor,
                           function(err) {
                             if (err) {
                               self._debug("[ERROR] Could not save anchor %o: %s", anchor, err)
                             } else {
                               self._debug("Saved anchor %o", anchor)
                             }
  })
}

MeshNode.prototype.listenToSignalingServer = function() {
  var self = this
  self.anchor(function(err, anchor) {
    if (err) {
      self._debug("[BYOSS] could not find anchor: %s", err)
    }
   
    if (anchor) {
      var signalingServer = anchor.signalingServer
      self._debug('Listening for BYOSS anchor applicants: %s', signalingServer)
      socket = io(signalingServer)
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

MeshNode.prototype.connectThroughAnchorSignalingServer = function() {
  var self = this
  self.anchor(function(err, anchor) {
    if(err) {
      self._debug('[BYOSS] No anchor: %s', err)
    }

    if (anchor) {
      var destination = anchor.id
      var signalingServer = anchor.signalingServer
      socket = io(signalingServer)
      self._debug('[BYOSS] anchorMeshNodeId: %s signalingServer %s', destination, signalingServer)
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
  })
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

      if (data.anchor) {
        self.saveAnchor(data.meshNodeId, data.anchor)
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
          }, 20)
        })
        guestCFirstPeer.signal(guestBOffer)
      })
    })
    // send the host's offer to Guest B
    guestBFirstPeer.signal(hostOffer)
  })
}

