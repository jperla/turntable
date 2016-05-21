/**********************************
 *  Base64 for ID3 image parsing
 **********************************/

// Modified version of http://www.webtoolkit.info/javascript-base64.html
(function(ns) {
    ns.Base64 = {
      // private property
      _keyStr : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",

      // public method for encoding
      encodeBytes : function (input) {
        var output = "";
        var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
        var i = 0;

        while (i < input.length) {

          chr1 = input[i++];
          chr2 = input[i++];
          chr3 = input[i++];

          enc1 = chr1 >> 2;
          enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
          enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
          enc4 = chr3 & 63;

          if (isNaN(chr2)) {
            enc3 = enc4 = 64;
          } else if (isNaN(chr3)) {
            enc4 = 64;
          }

          output = output +
          Base64._keyStr.charAt(enc1) + Base64._keyStr.charAt(enc2) +
          Base64._keyStr.charAt(enc3) + Base64._keyStr.charAt(enc4);

        }

        return output;
      }
    };
    
    // Export functions for closure compiler
    ns["Base64"] = ns.Base64;
    ns.Base64["encodeBytes"] = ns.Base64.encodeBytes;
})(this);

/*****************************
 *  Make random GUID
 *****************************/

function makeid(length)
{
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for( var i=0; i < length; i++ )
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}


/*****************************
 *  Base 64 <--> Hex
 *****************************/

if (!window.atob) {
  var tableStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var table = tableStr.split("");

  window.atob = function (base64) {
    if (/(=[^=]+|={3,})$/.test(base64)) throw new Error("String contains an invalid character");
    base64 = base64.replace(/=/g, "");
    var n = base64.length & 3;
    if (n === 1) throw new Error("String contains an invalid character");
    for (var i = 0, j = 0, len = base64.length / 4, bin = []; i < len; ++i) {
      var a = tableStr.indexOf(base64[j++] || "A"), b = tableStr.indexOf(base64[j++] || "A");
      var c = tableStr.indexOf(base64[j++] || "A"), d = tableStr.indexOf(base64[j++] || "A");
      if ((a | b | c | d) < 0) throw new Error("String contains an invalid character");
      bin[bin.length] = ((a << 2) | (b >> 4)) & 255;
      bin[bin.length] = ((b << 4) | (c >> 2)) & 255;
      bin[bin.length] = ((c << 6) | d) & 255;
    };
    return String.fromCharCode.apply(null, bin).substr(0, bin.length + n - 4);
  };

  window.btoa = function (bin) {
    for (var i = 0, j = 0, len = bin.length / 3, base64 = []; i < len; ++i) {
      var a = bin.charCodeAt(j++), b = bin.charCodeAt(j++), c = bin.charCodeAt(j++);
      if ((a | b | c) > 255) throw new Error("String contains an invalid character");
      base64[base64.length] = table[a >> 2] + table[((a << 4) & 63) | (b >> 4)] +
                              (isNaN(b) ? "=" : table[((b << 2) & 63) | (c >> 6)]) +
                              (isNaN(b + c) ? "=" : table[c & 63]);
    }
    return base64.join("");
  };

}

function hexToBase64(str) {
  return btoa(String.fromCharCode.apply(null,
    str.replace(/\r|\n/g, "").replace(/([\da-fA-F]{2}) ?/g, "0x$1 ").replace(/ +$/, "").split(" "))
  );
}

function base64ToHex(str) {
  for (var i = 0, bin = atob(str.replace(/[ \r\n]+$/, "")), hex = []; i < bin.length; ++i) {
    var tmp = bin.charCodeAt(i).toString(16);
    if (tmp.length === 1) tmp = "0" + tmp;
    hex[hex.length] = tmp;
  }
  return hex.join("");
}

function ab2str(buf) {
  return String.fromCharCode.apply(null, new Uint16Array(buf));
}

function str2ab(str) {
  var buf = new ArrayBuffer(str.length*2); // 2 bytes for each char
  var bufView = new Uint16Array(buf);
  for (var i=0, strLen=str.length; i<strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

function blobToDataURI(blob, callback) {
  var a = new FileReader()
  a.onload = function(e) { callback(e.target.result) }
  a.readAsDataURL(blob)
}

function getBlobAudioDuration(blob, callback) {
  var a = document.createElement('audio')
  blobToDataURI(blob, function(dataURI) {
    a.src = dataURI
    a.addEventListener('loadedmetadata', function() {
      callback(a.duration)
    })
  })
}

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

/*****************************
 *  SDP Reduction
 *****************************/

function get_reduced_sdp(desc){
	var sdp = desc.sdp
	var lines = sdp.split('\r\n')
	var ice_pwd = ""
	var ice_ufrag = ""
	var ip_s = new Array()
	var finger
	var type = (desc.type === 'offer' ? 'O' : 'A')
	//console.log(type)
	for(var i = 0; i < lines.length; i++){
			var temp = lines[i].split(':')
			if(temp[0] == 'a=ice-pwd'){
					ice_pwd = temp[1]
					//console.log('ice_pwd '+ice_pwd)
			}
			else if(temp[0] == 'a=ice-ufrag'){
					ice_ufrag = temp[1]
					//console.log('ice_ufrag: '+ice_ufrag)
			}
			else if(temp[0] == 'a=candidate') {
          var temp_split = temp[1].split(' ')
          for(var j = 0; j < temp_split.length; j++) {
              if(temp_split[j].indexOf('.') !== -1) {
                  if(temp_split[j+1] == 'rport'){
                      //console.log(temp_split[j] + " " + temp_split[j+2])
                      var t_arr = new Array([encode_ip(temp_split[j]), base32encode(temp_split[j+2])])
                      ip_s.push(encode_ip(temp_split[j])+':'+ base32encode(temp_split[j+2]))
                  } else {
                      var t_arr = new Array([encode_ip(temp_split[j]), base32encode(temp_split[j+1])])
                      ip_s.push(encode_ip(temp_split[j])+':'+base32encode(temp_split[j+1]))
                      //console.log(temp_split[j] + " " + temp_split[j+1])
                  }
                  break // End early since we don't want to capture the other local IP
              }
          }
          //console.log(temp[1])
					// ice_ufrag = temp[1]
					// console.log('ice_ufrag: '+ice_ufrag)
			}
			else if(temp[0] =='a=fingerprint'){
					var f = lines[i].split(' ')[1].split(':')
					var hex = f.map(function(h){
							return parseInt(h,16)
					})
					//console.log('hex: '+hex)
					finger = btoa(String.fromCharCode.apply(String, hex))
					console.log(finger)

					//console.log(f)

					//test

			}
	}
	var resp = type+','+ice_ufrag+','+ice_pwd+','+finger
	for(var k = 0; k< ip_s.length; k++){
			resp += ','+ip_s[k]
	}
	//console.log("length: "+ resp.length)

	console.log(resp)
	console.log('Length: '+ resp.length)
	//console.log(lines)
	//console.log(ip_s)
	return resp
}

function get_expanded_sdp(red) {
	var things = red.split(',')
	//console.log("EXPANDED:")
	//console.log(things)
	var type = (things[0] === 'O' ? 'offer' :'answer')
	var ice_ufrag = things[1]
	var ice_pwd = things[2]
	var finger = atob(things[3]).split('').map(function (c) {
    var d = c.charCodeAt(0)
    var e = c.charCodeAt(0).toString(16).toUpperCase()
    if (d < 16) {
      e = '0' + e
      return e
    }
  }).join(':')
	//console.log('type: ' +type)
	//console.log('ice_ufrag: ' +ice_ufrag)
	//console.log('ice_pwd: ' +ice_pwd)
	//console.log('fingerprint: ' +finger)
	var ip1 = things[4].split(":")
	var glob_ip = decode_ip(ip1[0])
	var glob_port = base32decode(ip1[1])

	//console.log('glob_ip: ' +glob_ip)
	//console.log('glob_port: ' +glob_port)

	var ip2 = things[5].split(":")
	var loc_ip = decode_ip(ip2[0])
	var loc_port = base32decode(ip2[1])

	//console.log('loc_ip: ' +loc_ip)
	//console.log('loc_port: ' +loc_port)

	var sdp = ['v=0',
			'o=- 5498186869896684180 2 IN IP4 127.0.0.1',
			's=-', 't=0 0', 'a=msid-semantic: WMS',
			'm=application 9 DTLS/SCTP 5000',
			'c=IN IP4 '+glob_ip,
			'a=mid:data',
			'a=sctpmap:5000 webrtc-datachannel 1024'
	]

	if (type === 'answer') {
			sdp.push('a=setup:active')
	} else {
			sdp.push('a=setup:actpass')
	}

	sdp.push('a=ice-ufrag:' + ice_ufrag)
	sdp.push('a=ice-pwd:' + ice_pwd)
	sdp.push('a=fingerprint:sha-256 ' + finger)

	sdp.push('a=candidate:328666875 1 udp 2122260223 '+loc_ip+' '+loc_port+' typ host generation 0')
	sdp.push('a=candidate:1561653771 1 tcp 1518280447 '+loc_ip+' 0 typ host tcptype active generation 0')
	sdp.push('a=candidate:3133702446 1 udp 1686052607 '+glob_ip+' '+glob_port+' typ srflx raddr '+loc_ip+' rport '+loc_port+' generation 0')
	//console.log(sdp)
	return {type: type, sdp: sdp.join('\r\n') + '\r\n'}

}

function d2h(d) {
	var temp = d.toString(16)
	if(d <16){
			return '0'+temp
	}
	else{
			return temp
	}
}
 
function encode_ip(ip) {
	var temp = ip.split('.')
	var ans = ""
	for(var i = 0; i < temp.length; i++){
			ans = ans + d2h(parseInt(temp[i]))
	}
	return ans
}

function decode_ip(ip) {
	var ret = new Array()
	for(var i = 0; i < ip.length/2; i++){
			var temp = ip.substring(i*2, (i+1)*2)
			ret.push(parseInt(temp, 16))
	}
	return ret.join('.')
}

function base32encode(num) {
	return parseInt(num).toString(32)
}

function base32decode(num) {
	return parseInt(num,32)
}
