FROM ubuntu:xenial
MAINTAINER Roderik van der Veer

ENV DEBIAN_FRONTEND noninteractive

RUN apt-get update && \
      apt-get -y -qq upgrade && \
      apt-get -y -qq install software-properties-common && \
      add-apt-repository ppa:ethereum/ethereum && \
      apt-get update && \
      apt-get -y -qq install geth solc && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/*

EXPOSE 8545
EXPOSE 30303


ADD ./test_net.sh /root/test_net.sh
RUN chmod +x /root/test_net.sh

ADD ./main_net.sh /root/main_net.sh
RUN chmod +x /root/main_net.sh


CMD /root/main_net.sh
