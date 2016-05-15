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

function makeid(length)
{
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for( var i=0; i < length; i++ )
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

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
