/*
 * Copyright (c) 2015 Sylvain Peyrefitte
 *
 * This file is part of mstsc.js.
 *
 * mstsc.js is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */
//

(function () {
  /**
   * Mouse button mapping
   * @param button {integer} client button number
   */
  function mouseButtonMap(button) {
    switch (button) {
      case 0:
        return 1;
      case 2:
        return 2;
      default:
        return 0;
    }
  }
  function parse(string, opts) {
    if (opts === void 0) {
      opts = {};
    }
    var encoding = {
      chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
      bits: 6,
    };
    // Build the character lookup table:
    if (!encoding.codes) {
      encoding.codes = {};

      for (var i = 0; i < encoding.chars.length; ++i) {
        encoding.codes[encoding.chars[i]] = i;
      }
    } // The string must have a whole number of bytes:

    if (!opts.loose && (string.length * encoding.bits) & 7) {
      //throw new SyntaxError('Invalid padding');
    } // Count the padding bytes:

    var end = string.length;

    while (string[end - 1] === "=") {
      --end; // If we get a whole number of bytes, there is too much padding:

      if (!opts.loose && !(((string.length - end) * encoding.bits) & 7)) {
        throw new SyntaxError("Invalid padding");
      }
    } // Allocate the output:

    var out = new (opts.out || Uint8Array)(((end * encoding.bits) / 8) | 0); // Parse the data:
    var bits = 0; // Number of bits currently in the buffer
    var buffer = 0; // Bits waiting to be written out, MSB first
    var written = 0; // Next byte to write

    for (var _i = 0; _i < end; ++_i) {
      // Read one character from the string:
      var value = encoding.codes[string[_i]];

      if (value === undefined) {
        throw new SyntaxError("Invalid character " + string[_i]);
      } // Append the bits to the buffer:

      buffer = (buffer << encoding.bits) | value;
      bits += encoding.bits; // Write out some bits if the buffer has a byte's worth:

      if (bits >= 8) {
        bits -= 8;
        out[written++] = 0xff & (buffer >> bits);
      }
    } // Verify that we have received just enough bits:

    if (bits >= encoding.bits || 0xff & (buffer << (8 - bits))) {
      throw new SyntaxError("Unexpected end of data");
    }

    return out;
  }

  /**
   * Mstsc client
   * Input client connection (mouse and keyboard)
   * bitmap processing
   * @param canvas {canvas} rendering element
   */
  function Client(canvas) {
    this.canvas = canvas;
    // create renderer
    this.render = new Mstsc.Canvas.create(this.canvas);
    this.socket = null;
    this.activeSession = false;
    this.install();
  }

  Client.prototype = {
    install: function () {
      var self = this;
      // bind mouse move event
      this.canvas.addEventListener("mousemove", function (e) {
        if (!self.socket) return;
        // console.log("mousemove");
        var offset = Mstsc.elementOffset(self.canvas);
        //self.socket.emit('mouse', e.clientX - offset.left, e.clientY - offset.top, 0, false);
        e.preventDefault || !self.activeSession();
        return false;
      });
      this.canvas.addEventListener("mousedown", function (e) {
        if (!self.socket) return;
        console.log("mousedown");
        var offset = Mstsc.elementOffset(self.canvas);
        self.socket.emit(
          "mouse",
          e.clientX - offset.left,
          e.clientY - offset.top,
          mouseButtonMap(e.button),
          true
        );
        e.preventDefault();
        return false;
      });
      this.canvas.addEventListener("mouseup", function (e) {
        if (!self.socket || !self.activeSession) return;
        console.log("mouseup");
        var offset = Mstsc.elementOffset(self.canvas);
        self.socket.emit(
          "mouse",
          e.clientX - offset.left,
          e.clientY - offset.top,
          mouseButtonMap(e.button),
          false
        );
        e.preventDefault();
        return false;
      });
      this.canvas.addEventListener("contextmenu", function (e) {
        if (!self.socket || !self.activeSession) return;
        console.log("contextmenu");
        var offset = Mstsc.elementOffset(self.canvas);
        self.socket.emit(
          "mouse",
          e.clientX - offset.left,
          e.clientY - offset.top,
          mouseButtonMap(e.button),
          false
        );
        e.preventDefault();
        return false;
      });
      this.canvas.addEventListener("DOMMouseScroll", function (e) {
        if (!self.socket || !self.activeSession) return;
        console.log("DOMMouseScroll");
        var isHorizontal = false;
        var delta = e.detail;
        var step = Math.round((Math.abs(delta) * 15) / 8);

        var offset = Mstsc.elementOffset(self.canvas);
        self.socket.emit(
          "wheel",
          e.clientX - offset.left,
          e.clientY - offset.top,
          step,
          delta > 0,
          isHorizontal
        );
        e.preventDefault();
        return false;
      });
      this.canvas.addEventListener("mousewheel", function (e) {
        if (!self.socket || !self.activeSession) return;
        console.log("mousewheel");
        // 水平方向的滚动量大于垂直方向，isHorizontal 将为 true，否则为 false
        var isHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
        var delta = isHorizontal ? e.deltaX : e.deltaY;
        var step = Math.round((Math.abs(delta) * 15) / 8);

        var offset = Mstsc.elementOffset(self.canvas);
        self.socket.emit(
          "wheel",
          e.clientX - offset.left, // 鼠标在画布上的 X 坐标
          e.clientY - offset.top,
          step,
          delta > 0,
          isHorizontal
        );
        e.preventDefault();
        return false;
      });

      return this;
    },
    /**
     * connect
     * @param ip {string} ip target for rdp
     * @param domain {string} microsoft domain
     * @param username {string} session username
     * @param password {string} session password
     * @param next {function} asynchrone end callback
     */
    connect: function (ip, port, domain, username, password, next) {
      // compute socket.io path (cozy cloud integration)
      var parts = document.location.pathname.split("/"),
        base = parts.slice(0, parts.length - 1).join("/") + "/",
        path = base + "socket.io";

      // start connection
      var self = this;
      var url = window.location.protocol + "//" + window.location.host;
      this.socket = io(url, { path: path, forceNew: true })
        .on("rdp-connect", function () {
          // this event can be occured twice (RDP protocol stack artefact)
          self.activeSession = true;
          self.socket.emit("infos", {
            ip: ip,
            port: port,
            screen: {
              width: self.canvas.width,
              height: self.canvas.height,
            },
            domain: domain,
            username: username,
            password: password,
            locale: Mstsc.locale(),
          });
          // next();
        })
        .on("rdp-bitmap", function (bitmaps) {
          next();
          for (var i in bitmaps) {
            var bitmap = bitmaps[i];
            bitmap["data"] = parse(bitmaps[i].data);
            console.log(bitmap);
            console.log("[mstsc.js] bitmap update925:" + bitmap.bitsPerPixel);
            self.render.update(bitmap);
          }
        })
        .on("rdp-close", function () {
          next(null);
          console.log("[mstsc.js] close");
          self.activeSession = false;
        })
        .on("rdp-error", function (err) {
          next(err);
          console.log(err);
          console.log(
            "[mstsc.js] error : " + err["code"] + "(" + err["message"] + ")"
          );
          // alert('error : ' + err["message"])
          self.activeSession = false;
          // self.socket.disconnect();
          self.socket.close();
        });
    },
    disconnect: function () {
      this.socket.close();
    },
    keydown: function (e) {
      var self = this;
      console.log("keydown", e);
      if (!self.socket || !self.activeSession) return;
      console.log("keydown22");
      self.socket.emit("scancode", Mstsc.scancode(e), true);
      return false;
    },
    keyup: function (e) {
      var self = this;
      console.log("keyup", e);
      if (!self.socket || !self.activeSession) return;
      console.log("keyup22");
      self.socket.emit("scancode", Mstsc.scancode(e), false);
      return false;
    },
  };

  Mstsc.client = {
    create: function (canvas) {
      return new Client(canvas);
    },
  };
})();
